import { scanDomain } from '../services/seoScanner.js';
import { DomainReportSchema } from '../models/DomainReport.js';
import { DomainSummarySchema } from '../models/DomainSummary.js';
import { DomainSchema } from '../models/Domain.js';
import { mongoMultiConnector } from '../services/mongoMultiConnector.js';
import { logger } from '../utils/logger.js';
import { calculateNextScanAt } from '../utils/scheduling.js';
import { PolicySchema } from '../models/Policy.js';
import { RuleSchema } from '../models/Rule.js';
import { PolicyReportSchema } from '../models/PolicyReport.js';
import { PolicyEvaluator } from '../services/policyEvaluator.js';
import mongoose from 'mongoose';
import { AuditSchema } from '../models/Audit.js';
import { runAuditScan } from '../services/auditScan.js';
import { runQaScan } from '../services/qaScanner.js';


export const processScanDomain = async (job) => {
  const { 
    domainName, 
    pageLimit, 
    scanSubdomains, 
    executeJs, 
    fullResourceReport,
    sourceDb, 
    sourceUri, 
    sourceDomainDocId 
  } = job.data;
  const startTime = Date.now();
  const scanJobId = (job.id || "job") + "-" + Date.now();
  
  try {
    // 1. Get Connection
    if (!sourceUri || !sourceDb) {
      throw new Error(`Missing connection info for domain ${domainName}`);
    }
    const conn = await mongoMultiConnector.getClientConnection(sourceUri, sourceDb);
    const DomainModel = conn.model('Domain', DomainSchema);
    const DomainReportModel = conn.model('DomainReport', DomainReportSchema);
    const DomainSummaryModel = conn.model('DomainSummary', DomainSummarySchema);

    // 2. Pre-scan check: Is domain still valid?
    if (sourceDomainDocId) {
      const currentDomain = await DomainModel.findById(sourceDomainDocId);
      logger.info(`[${domainName}] Checking domain status for ID: ${sourceDomainDocId}. Found: ${!!currentDomain}, Deleted: ${currentDomain?.dm_is_deleted}, Archived: ${currentDomain?.dm_is_archived}, Status: ${currentDomain?.dm_status}`);
      
      if (!currentDomain || currentDomain.dm_is_deleted || currentDomain.dm_is_archived || currentDomain.dm_status !== 'active') {
        const reason = !currentDomain ? 'not found' : (currentDomain.dm_is_deleted ? 'deleted' : (currentDomain.dm_is_archived ? 'archived' : 'inactive'));
        logger.info(`[${domainName}] ⏭️ Skipping scan: Domain is ${reason}.`);
        
        // Revert status if it was set to 'scanning' by orchestrator
        if (currentDomain && currentDomain.dm_seo_status === 'scanning') {
          await DomainModel.findByIdAndUpdate(sourceDomainDocId, { dm_seo_status: 'pending' });
        }
        return { success: false, skipped: true, reason };
      }
    }

    // 3. Mark scanning
    if (sourceDomainDocId) {
      try {
        await DomainModel.findByIdAndUpdate(sourceDomainDocId, { 
            dm_seo_status: 'scanning',
            dm_updated_at: new Date()
        });
      } catch (e) { logger.warn(`Could not update status to scanning: ${e.message}`); }
    }

    // 3. Perform Scan
    const reports = await scanDomain(domainName, {
        pageLimit: pageLimit || 500,
        scanSubdomains: scanSubdomains ?? true,
        executeJs: executeJs ?? false,
        fullResourceReport: fullResourceReport ?? true
    });
    const durationMs = Date.now() - startTime;

    // 4. Policy Evaluation
    let policyHitsSummary = [];
    let policyHitDocs = [];
    let policiesWithRules = [];
    try {
      const PolicyModel = conn.model('Policy', PolicySchema);
      
      const policies = await PolicyModel.find({ 
        is_active: true, 
        is_deleted: false,
        $or: [
          { isGlobal: true },
          { domainIds: sourceDomainDocId }
        ]
      }).lean();
      
      policiesWithRules = policies;

      if (policiesWithRules.length > 0) {
        logger.info(`[${domainName}] Evaluating ${policiesWithRules.length} policies against ${reports.length} pages.`);
        
        reports.forEach(report => {
          const pageResults = PolicyEvaluator.processPolicies(policiesWithRules, {
            ...report,
            html: report.html,
            bodyText: report.bodyText
          });
          
          report.policies = pageResults;
          
          // Track overall hits for summary and separate report
          pageResults.forEach(res => {
            if (res.isHit) {
              policyHitsSummary.push({
                url: report.url,
                policyId: res.policyId,
                title: res.title,
                category: res.category,
                priority: res.priority
              });

              policyHitDocs.push({
                policyId: res.policyId,
                domainId: sourceDomainDocId,
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
                tenantId: sourceDb.replace(/^tenant_|^sitemonitor_/, '') // Extract tenantId from DB name
              });
            }
          });

          // Cleanup report before saving to DB
          delete report.html;
          delete report.bodyText;
        });
      } else {
        // Just cleanup if no policies
        reports.forEach(report => {
          delete report.html;
          delete report.bodyText;
        });
      }
    } catch (policyErr) {
      logger.error(`Error evaluating policies for ${domainName}: ${policyErr.message}`);
      // Ensure cleanup even if evaluation fails
      reports.forEach(report => {
        delete report.html;
        delete report.bodyText;
      });
    }

    // 5. Save results to Client DB
    const reportDocs = reports.map(report => ({ 
      ...report, 
      jobId: scanJobId, 
      sourceDomainDocId: sourceDomainDocId, 
      scanCompletedAt: new Date(), 
      scanDurationMs: durationMs, 
      status: 'success' 
    }));

    if (reportDocs.length > 0) {
      await DomainReportModel.insertMany(reportDocs);
      logger.info(`✅ [${domainName}] Saved ${reportDocs.length} pages to database ${sourceDb}.`);

      // 5.1. Save Policy Hits separately
      if (policyHitDocs.length > 0) {
        const PolicyReportModel = conn.model('PolicyReport', PolicyReportSchema);
        await PolicyReportModel.insertMany(policyHitDocs);
        logger.info(`🚨 [${domainName}] Saved ${policyHitDocs.length} policy hits to database ${sourceDb}.`);
      }

      // 4.1. Calculate and Save Domain Summary
      try {
        const totalScore = reports.reduce((sum, r) => sum + (r.seoScore || 0), 0);
        const avgScore = reports.length > 0 ? (totalScore / reports.length) : 0;
        
        const totalLoadTimeMs = reports.reduce((sum, r) => {
          const time = parseFloat(r.performance?.advancedMetrics?.totalPageLoadTime || 0);
          return sum + (time * 1000);
        }, 0);
        const avgLoadTime = reports.length > 0 ? (totalLoadTimeMs / reports.length) : 0;

        const issueBreakdown = { high: 0, medium: 0, low: 0, highPages: 0, mediumPages: 0, lowPages: 0 };
        const issueCounts = new Map();
        const pagesWithHigh = new Set();
        const pagesWithMedium = new Set();
        const pagesWithLow = new Set();

        const normalizeMessageForGrouping = (msg) => {
          return msg
            .replace(/\(\d+(\.\d+)?s?\)/g, '(...)') // Normalize performance values like (3.15s)
            .replace(/\d+\s+key\s+legal\s+terms/i, 'key legal terms') // Normalize T&C counts
            .replace(/\d+\s+image\(s\)/i, 'images') // Normalize image counts
            .replace(/\d+\s+spelling\s+issues/i, 'spelling issues')
            .replace(/\d+\s+broken\s+links/i, 'broken links')
            .replace(/\d+\s+large\s+images/i, 'large images')
            .replace(/>\d+KB/i, '>KB')
            .replace(/\s+/g, ' ')
            .trim();
        };

        reports.forEach(r => {
          (r.seoImprovements || []).forEach(imp => {
            issueBreakdown[imp.priority] = (issueBreakdown[imp.priority] || 0) + 1;
            if (imp.priority === 'high') pagesWithHigh.add(r.url);
            if (imp.priority === 'medium') pagesWithMedium.add(r.url);
            if (imp.priority === 'low') pagesWithLow.add(r.url);

            const normalizedMessage = normalizeMessageForGrouping(imp.message);
            const key = `${imp.type}:${normalizedMessage}`;
            if (!issueCounts.has(key)) {
              issueCounts.set(key, { 
                ...imp, 
                message: normalizedMessage,
                count: 0 
              });
            }
            issueCounts.get(key).count++;
          });
        });

        issueBreakdown.highPages = pagesWithHigh.size;
        issueBreakdown.mediumPages = pagesWithMedium.size;
        issueBreakdown.lowPages = pagesWithLow.size;

        const totalUniqueIssues = issueCounts.size;
        const topIssues = Array.from(issueCounts.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, 15);

        const lastReport = reports[reports.length - 1]; // Use last report for global flags
        const host = domainName.toLowerCase().trim().replace(/^https?[:/\\]+/i, '').replace(/[/\\]+.*$/, '');
        const rootReport = reports.find(r => {
          const rUrl = r.url.replace(/\/$/, '');
          return rUrl === `https://${host}` || rUrl === `http://${host}` || rUrl === `https://www.${host}` || rUrl === `http://www.${host}`;
        }) || lastReport;

        const normalizedDomain = host;

        const summaryDoc = {
          domain: normalizedDomain,
          finalSeoScore: reports.length > 0 ? Math.round(reports.reduce((sum, r) => sum + (r.seoScore || 0), 0) / reports.length) : 0,
          rootHttpStatus: rootReport?.httpStatus || 0,
          totalPages: reports.length,
          averageLoadTime: (avgLoadTime / 1000).toFixed(2) + 's',
          totalNetworkWeight: (reports.reduce((sum, r) => sum + parseFloat(r.networkMetrics?.totalTransferredSize || 0), 0) / (reports.length || 1)).toFixed(2) + 'KB',
          totalUniqueIssues,
          issueBreakdown,
          topIssues,
          securitySummary: {
            sslValid: lastReport.security?.sslValid ?? false,
            hasCustom404: lastReport.additionalChecks?.hasCustom404 ?? false
          },
          performanceMetrics: {
            avgPerformanceScore: reports.length > 0 
              ? Math.round(reports.reduce((sum, r) => sum + (r.performance?.advancedMetrics?.performanceScore || 0), 0) / reports.length)
              : 0,
            avgLCP: reports.length > 0 
              ? (reports.reduce((sum, r) => sum + (r.performance?.coreWebVitals?.LCP || 0), 0) / reports.length).toFixed(2)
              : 0,
            avgCLS: reports.length > 0 
              ? (reports.reduce((sum, r) => sum + (r.performance?.coreWebVitals?.CLS || 0), 0) / reports.length).toFixed(3)
              : 0,
            avgAccessibilityScore: reports.length > 0
              ? Math.round(reports.reduce((sum, r) => sum + (r.lighthouseAccessibilityScore || 0), 0) / reports.length)
              : 0
          },
          complianceSummary: {
            termsFound: lastReport.additionalChecks?.compliance?.terms || false,
            termsUrl: lastReport.additionalChecks?.compliance?.termsUrl || null,
            keywordsFound: lastReport.additionalChecks?.compliance?.keywordsFound || [],
            keywordsMissing: lastReport.additionalChecks?.compliance?.keywordsMissing || [],
            scoreImpact: (lastReport.seoImprovements || []).filter(imp => imp.type === 'compliance').reduce((acc, imp) => acc + (imp.priority === 'high' ? 14 : 7), 0)
          },
          policySummary: {
            totalPolicies: policiesWithRules.length,
            totalHits: policyHitsSummary.length,
            hitBreakdown: {
              high: policyHitsSummary.filter(h => h.priority === 'High').length,
              medium: policyHitsSummary.filter(h => h.priority === 'Medium').length,
              low: policyHitsSummary.filter(h => h.priority === 'Low').length
            }
          },
          lastScanDate: new Date(),
          jobId: scanJobId
        };

        // Update Policy stats in DB
        const PolicyModel = conn.model('Policy', PolicySchema);
        for (const policy of policiesWithRules) {
          const hitsForThisPolicy = policyHitsSummary.filter(h => h.policyId.toString() === policy._id.toString()).length;
          const compliance = reports.length > 0 ? Math.round(((reports.length - hitsForThisPolicy) / reports.length) * 100) : 100;
          
          // Calculate total match occurrences across all pages
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

        await DomainSummaryModel.create(summaryDoc);
        logger.info(`📊 [${domainName}] Domain summary created in ${sourceDb}. Final Score: ${summaryDoc.finalSeoScore}`);

        // Compile and save snapshot to detailed Audit collection
        try {
          await runAuditScan(reports, summaryDoc, domainName, scanJobId, conn);
        } catch (auditErr) {
          logger.error(`Error executing audit scan compiler for ${domainName}: ${auditErr.message}`);
        }

        // QA scan – page-wise quality assurance data
        try {
          const domainDoc = sourceDomainDocId
            ? await DomainModel.findById(sourceDomainDocId).lean()
            : null;
          const { fetchSitemapPageUrls } = await import('../services/qaScanner.js');
          const xmlUrls = await fetchSitemapPageUrls(domainName);
          const sitemapUrls = [
            ...new Set([
              ...reports.map((r) => r.url),
              ...xmlUrls,
              ...reports.flatMap((r) => r.links?.internalUrls || []),
            ]),
          ];
          await runQaScan(domainName, reports, scanJobId, conn, {
            ignoredSpellings: domainDoc?.dm_ignored_spellings || [],
            sitemapUrls,
          });
        } catch (qaErr) {
          logger.error(`Error executing QA scan for ${domainName}: ${qaErr.message}`);
        }

        // Accessibility scan – page-wise accessibility data
        try {
          const { runAccessibilityScan } = await import('../services/accessibilityScanner.js');
          await runAccessibilityScan(domainName, reports, scanJobId, conn);
        } catch (accErr) {
          logger.error(`Error executing Accessibility scan for ${domainName}: ${accErr.message}`);
        }
      } catch (sumErr) {
        logger.error(`Error calculating summary for ${domainName}: ${sumErr.message}`);
      }
    }

    // 5. Mark completed and schedule next scan
    if (sourceDomainDocId) {
      try {
        const domain = await DomainModel.findById(sourceDomainDocId);
        const nextScanAt = calculateNextScanAt(
          domain?.dm_scan_frequency || 1,
          domain?.dm_frequency_type || 'day',
          '00:00',
          new Date()
        );

        await DomainModel.findByIdAndUpdate(sourceDomainDocId, { 
            dm_seo_status: 'completed', 
            dm_last_scan_at: new Date(),
            dm_next_scan_at: nextScanAt,
            dm_updated_at: new Date() 
        });
      } catch (e) { logger.warn(`Could not update status to completed: ${e.message}`); }
    }

    return { success: true, pagesScanned: reports.length, durationMs };
  } catch (error) {
    logger.error(`Error in processor for ${domainName}: ${error.stack}`);
    
    // Attempt failure status update if we have enough info
    if (sourceUri && sourceDb && sourceDomainDocId) {
      try {
        const conn = await mongoMultiConnector.getClientConnection(sourceUri, sourceDb);
        const DomainModel = conn.model('Domain', DomainSchema);
        await DomainModel.findByIdAndUpdate(sourceDomainDocId, { 
            dm_seo_status: 'failed',
            dm_last_scan_at: new Date(),
            dm_updated_at: new Date()
        });
      } catch (e) { logger.warn(`Could not update status to failed: ${e.message}`); }
    }
    throw error;
  }
};

