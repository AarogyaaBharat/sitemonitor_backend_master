import { DomainSchema } from '../models/Domain.js';
import { PolicySchema } from '../models/Policy.js';
import { PolicyReportSchema } from '../models/PolicyReport.js';
import { DomainReportSchema } from '../models/DomainReport.js';
import { PolicySummarySchema } from '../models/PolicySummary.js';
import { PolicyEvaluator } from '../services/policyEvaluator.js';
import { mongoMultiConnector } from '../services/mongoMultiConnector.js';
import { logger } from '../utils/logger.js';
import mongoose from 'mongoose';
import axios from 'axios';
import * as cheerio from 'cheerio';
import https from 'https';

/**
 * Standalone Policy scan job – processes existing DomainReports against Policies.
 */
export const processPolicyScan = async (job) => {
  const {
    domainId,
    domainName,
    sourceDb,
    sourceUri,
  } = job.data;
  const startTime = Date.now();
  const scanJobId = job.id ? String(job.id) : `policy-job-${Date.now()}`;

  let conn;

  try {
    if (!sourceUri || !sourceDb) {
      throw new Error(`Missing connection info for domain ${domainName}`);
    }

    conn = await mongoMultiConnector.getClientConnection(sourceUri, sourceDb);
    const DomainModel = conn.model('Domain', DomainSchema);
    const PolicyModel = conn.model('Policy', PolicySchema);
    const PolicyReportModel = conn.model('PolicyReport', PolicyReportSchema);
    const DomainReportModel = conn.model('DomainReport', DomainReportSchema);
    const PolicySummaryModel = conn.model('PolicySummary', PolicySummarySchema);

    if (domainId) {
      await DomainModel.findByIdAndUpdate(domainId, {
        dm_policy_status: 'scanning',
        dm_updated_at: new Date(),
      });
    }

    logger.info(`🛡️ [${domainName}] Starting standalone Policy Scan (job ${scanJobId})...`);

    // 1. Fetch the latest reports for the domain
    // We aggregate by URL to get the most recent report for each URL
    const latestReportsAgg = await DomainReportModel.aggregate([
      { $match: { sourceDomainDocId: new mongoose.Types.ObjectId(domainId) } },
      { $sort: { scanDate: -1 } },
      {
        $group: {
          _id: "$url",
          doc: { $first: "$$ROOT" }
        }
      }
    ]);
    const reports = latestReportsAgg.map(r => r.doc);

    logger.info(`📑 [${domainName}] Retrieved ${reports.length} recent domain reports for evaluation.`);

    // 2. Fetch Policies
    const policies = await PolicyModel.find({ 
      is_deleted: false,
      $or: [
        { isGlobal: true },
        { domainIds: domainId }
      ]
    }).lean();

    if (policies.length === 0) {
      logger.info(`ℹ️ [${domainName}] No active policies found to evaluate.`);
      if (domainId) {
        await DomainModel.findByIdAndUpdate(domainId, { dm_policy_status: 'completed', dm_updated_at: new Date() });
      }
      return { success: true, pagesScanned: 0, durationMs: Date.now() - startTime, jobId: scanJobId };
    }

    logger.info(`⚖️ [${domainName}] Evaluating ${policies.length} policies against ${reports.length} pages.`);

    // --- DEBUG LOGGING FOR RULES ---
    policies.forEach(p => {
      logger.info(`📋 Policy: "${p.title}"`);
      if (p.rules) {
        p.rules.forEach((r, i) => {
          logger.info(`   Rule ${i + 1}: Type=[${r.type}], Target=[${r.searchValue || r.value || ''}], SearchType=[${r.searchType || r.comparison || ''}], Contains/Unit=[${r.containing || r.unit || ''}]`);
        });
      }
    });
    // -------------------------------

    // 3. Delete old policy reports
    await PolicyReportModel.deleteMany({ domainId: domainId });

    // 4. Fetch Live Content if needed
    const needsContentFetch = policies.some(p => 
      p.rules && p.rules.some(r => ['text', 'page-html'].includes(r.type))
    );

    if (needsContentFetch) {
      logger.info(`🌐 [${domainName}] Fetching live HTML content for ${reports.length} pages (text-based rules detected)...`);
      const chunkSize = 10;
      const httpsAgent = new https.Agent({ rejectUnauthorized: false });
      
      for (let i = 0; i < reports.length; i += chunkSize) {
        const chunk = reports.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async (report) => {
          try {
            const res = await axios.get(report.url, { 
              timeout: 10000, 
              maxRedirects: 5,
              httpsAgent 
            });
            report.html = res.data;
            const $ = cheerio.load(res.data);
            $('script, style, noscript, iframe, svg').remove();
            report.bodyText = $('body').text().replace(/\s+/g, ' ').trim();
          } catch (e) {
            logger.warn(`Failed to fetch live content for ${report.url}: ${e.message}`);
            report.html = '';
            report.bodyText = '';
          }
        }));
      }
    }

    // 5. Evaluate
    let policyHitsSummary = [];
    let policyHitDocs = [];
    const tenantId = sourceDb.replace(/^tenant_|^sitemonitor_/, '');

    reports.forEach(report => {
      const pageResults = PolicyEvaluator.processPolicies(policies, report);
      
      pageResults.forEach(res => {
        if (res.isHit) {
          policyHitsSummary.push({
            policyId: res.policyId,
            priority: res.priority
          });

          policyHitDocs.push({
            policyId: res.policyId,
            domainId: domainId,
            domainName: domainName,
            url: report.url,
            isHit: true,
            matchCount: res.matchCount || 0,
            totalCount: res.totalCount || 0,
            category: res.category,
            priority: res.priority,
            matchedRules: res.matchedRules,
            evaluationResults: res.evaluationResults,
            scanDate: new Date(),
            jobId: scanJobId,
            tenantId: tenantId
          });
        }
      });
    });

    // 5. Save Policy hits
    if (policyHitDocs.length > 0) {
      await PolicyReportModel.insertMany(policyHitDocs);
      logger.info(`🚨 [${domainName}] Saved ${policyHitDocs.length} policy hits to database ${sourceDb}.`);
    } else {
      logger.info(`✨ [${domainName}] No policy violations found during this scan.`);
    }

    // 6. Update Policy Stats
    for (const policy of policies) {
      const hitsForThisPolicy = policyHitsSummary.filter(h => h.policyId.toString() === policy._id.toString()).length;
      const compliance = reports.length > 0 ? Math.round(((reports.length - hitsForThisPolicy) / reports.length) * 100) : 100;
      
      const totalMatches = policyHitDocs
        .filter(h => h.policyId.toString() === policy._id.toString())
        .reduce((sum, h) => sum + (h.matchCount || 0), 0);

      const totalItems = policyHitDocs
        .filter(h => h.policyId.toString() === policy._id.toString())
        .reduce((sum, h) => sum + (h.totalCount || 0), 0);

      await PolicyModel.findByIdAndUpdate(policy._id, {
        policyHits: hitsForThisPolicy,
        foundCount: totalMatches,
        totalCount: totalItems,
        compliancePercent: compliance,
        status: hitsForThisPolicy > 0 ? 'hits' : 'compliant'
      });
    }

    // 7. Create and Save PolicySummary
    const uniqueHitUrls = new Set(policyHitDocs.map(h => h.url));
    const contentWithViolations = uniqueHitUrls.size;
    const overallCompliance = reports.length > 0 
      ? Math.round(((reports.length - contentWithViolations) / reports.length) * 100) 
      : 100;

    const policiesWithViolations = policies.filter(p => policyHitsSummary.some(h => h.policyId.toString() === p._id.toString())).length;

    const summaryPriorities = { high: 0, medium: 0, low: 0 };
    policyHitDocs.forEach(h => {
      const p = (h.priority || 'medium').toLowerCase();
      if (summaryPriorities[p] !== undefined) summaryPriorities[p]++;
    });

    const summaryDistribution = { unwanted: 0, required: 0, matches: 0 };
    policyHitDocs.forEach(h => {
      const c = (h.category || 'matches').toLowerCase();
      if (summaryDistribution[c] !== undefined) summaryDistribution[c]++;
    });

    const summaryDoc = {
      domainId: domainId,
      tenantId: tenantId,
      jobId: scanJobId,
      scanDate: new Date(),
      totalPolicies: policies.length,
      policiesWithViolations: policiesWithViolations,
      contentWithViolations: contentWithViolations,
      compliancePercent: overallCompliance,
      priorities: summaryPriorities,
      distribution: summaryDistribution
    };

    await PolicySummaryModel.create(summaryDoc);
    logger.info(`📊 [${domainName}] Saved PolicySummary snapshot.`);

    if (domainId) {
      await DomainModel.findByIdAndUpdate(domainId, {
        dm_policy_status: 'completed',
        dm_policy_last_scan_at: new Date(),
        dm_updated_at: new Date(),
      });
    }

    const durationMs = Date.now() - startTime;
    logger.info(`✅ Policy scan completed for ${domainName} in ${durationMs}ms`);
    return { success: true, pagesScanned: reports.length, durationMs, jobId: scanJobId };
  } catch (err) {
    logger.error(`Policy scan error for ${domainName}: ${err.stack}`);
    if (domainId && conn) {
      try {
        const DomainModel = conn.model('Domain', DomainSchema);
        await DomainModel.findByIdAndUpdate(domainId, {
          dm_policy_status: 'failed',
          dm_updated_at: new Date(),
        });
      } catch (updateErr) {
        logger.warn(`Could not set Policy status to failed: ${updateErr.message}`);
      }
    }
    throw err;
  }
};
