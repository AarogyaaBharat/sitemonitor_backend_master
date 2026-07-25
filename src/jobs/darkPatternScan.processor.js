import { scanDomain } from '../services/seoScanner.js';
import { scanPageForDarkPatterns } from '../services/darkPatternScanner.js';
import { scanPrivacyBanner } from '../services/privacyScanner.js';
import { simulateCheckoutFlow } from '../services/checkoutSimulator.js';
import { scanVisualDeception } from '../services/visualDeceptionScanner.js';
import { DomainSchema } from '../models/Domain.js';
import { DarkPatternReportSchema } from '../models/DarkPatternReport.js';
import { DarkPatternSummarySchema } from '../models/DarkPatternSummary.js';
import { mongoMultiConnector } from '../services/mongoMultiConnector.js';
import { logger } from '../utils/logger.js';

export const processDarkPatternScan = async (job) => {
  const {
    domainName,
    pageLimit,
    scanSubdomains,
    executeJs,
    sourceDb,
    sourceUri,
    sourceDomainDocId,
  } = job.data;
  
  const scanJobId = `darkpattern-${job.id || 'job'}-${Date.now()}`;
  let conn;
  let DomainModel, DarkPatternReport, DarkPatternSummary;

  try {
    if (!sourceUri || !sourceDb) {
      throw new Error(`Missing connection info for domain ${domainName}`);
    }

    conn = await mongoMultiConnector.getClientConnection(sourceUri, sourceDb);
    DomainModel = conn.model('Domain', DomainSchema);
    DarkPatternReport = conn.model('DarkPatternReport', DarkPatternReportSchema);
    DarkPatternSummary = conn.model('DarkPatternSummary', DarkPatternSummarySchema);

    const domainDoc = sourceDomainDocId
      ? await DomainModel.findById(sourceDomainDocId).lean()
      : null;

    logger.info(`[${domainName}] Starting Dark Pattern crawl (job ${scanJobId})...`);
    
    // We crawl the domain. We limit to fewer pages by default to not overload local Ollama
    const actualPageLimit = pageLimit ? Math.min(pageLimit, 50) : 10; 
    
    const reports = await scanDomain(domainName, {
      pageLimit: actualPageLimit,
      scanSubdomains: scanSubdomains ?? false,
      executeJs: executeJs ?? false,
      fullResourceReport: false,
      skipLighthouse: true,
      customUrls: domainDoc?.dm_custom_urls || job.data.dm_custom_urls,
    });

    logger.info(`[${domainName}] Crawl complete. Scanning ${reports.length} pages for dark patterns using Ollama...`);

    let totalIssuesFound = 0;
    const severityCounts = { high: 0, medium: 0, low: 0 };
    const typeDistribution = {};

    // Hold new reports in memory during the scan so old data remains visible
    const newReports = [];

    // 1. Run Privacy Banner scan on the homepage
    logger.info(`[${domainName}] Running Privacy Zuckering scanner on homepage...`);
    const privacyIssues = await scanPrivacyBanner(domainName);
    
    // Save any privacy issues found
    for (const pIssue of privacyIssues) {
      newReports.push({
        domain: domainName,
        jobId: scanJobId,
        url: domainName,
        type: pIssue.type,
        severity: pIssue.severity,
        severityClass: pIssue.severity.toLowerCase() === 'high' ? 'bg-danger text-white' : 'bg-warning text-dark',
        description: pIssue.description,
        suggestion: pIssue.suggestion,
        legalRisk: pIssue.legalRisk
      });
      totalIssuesFound++;
      const s = pIssue.severity.toLowerCase();
      if (severityCounts[s] !== undefined) severityCounts[s]++;
      typeDistribution[pIssue.type] = (typeDistribution[pIssue.type] || 0) + 1;
    }

    // 2. Run Behavioral Checkout Simulation
    logger.info(`[${domainName}] Running Checkout Flow Simulator...`);
    const checkoutIssues = await simulateCheckoutFlow(domainName);
    
    // Save any checkout issues found
    for (const cIssue of checkoutIssues) {
      newReports.push({
        domain: domainName,
        jobId: scanJobId,
        url: domainName,
        type: cIssue.type,
        severity: cIssue.severity,
        severityClass: cIssue.severity.toLowerCase() === 'high' ? 'bg-danger text-white' : 'bg-warning text-dark',
        description: cIssue.description,
        suggestion: cIssue.suggestion,
        legalRisk: cIssue.legalRisk
      });
      totalIssuesFound++;
      const s = cIssue.severity.toLowerCase();
      if (severityCounts[s] !== undefined) severityCounts[s]++;
      typeDistribution[cIssue.type] = (typeDistribution[cIssue.type] || 0) + 1;
    }

    // 3. Run Visual Deception Scan (LLaVA)
    logger.info(`[${domainName}] Running Visual AI Deception Scanner...`);
    const visualIssues = await scanVisualDeception(domainName);
    
    // Save any visual issues found
    for (const vIssue of visualIssues) {
      newReports.push({
        domain: domainName,
        jobId: scanJobId,
        url: domainName,
        type: vIssue.type,
        severity: vIssue.severity,
        severityClass: vIssue.severity.toLowerCase() === 'high' ? 'bg-danger text-white' : 'bg-warning text-dark',
        description: vIssue.description,
        suggestion: vIssue.suggestion,
        legalRisk: vIssue.legalRisk,
        // Save the full screenshot as a data URI so the frontend can render it
        htmlSnippet: vIssue.screenshotBase64 ? `data:image/jpeg;base64,${vIssue.screenshotBase64}` : undefined
      });
      totalIssuesFound++;
      const s = vIssue.severity.toLowerCase();
      if (severityCounts[s] !== undefined) severityCounts[s]++;
      typeDistribution[vIssue.type] = (typeDistribution[vIssue.type] || 0) + 1;
    }

    // 4. Loop through each crawled page for Ollama Text Analysis
    for (const report of reports) {
      if (report.httpStatus !== 200 || !report.html) continue;

      logger.info(`  -> Analyzing ${report.url} with Ollama...`);
      const issues = await scanPageForDarkPatterns(report.html, report.url);
      
      if (issues && issues.length > 0) {
        for (const issue of issues) {
          totalIssuesFound++;
          const sev = (issue.severity || 'low').toLowerCase();
          if (severityCounts[sev] !== undefined) severityCounts[sev]++;
          else severityCounts.low++;

          const typeName = issue.type || 'Unknown Pattern';
          typeDistribution[typeName] = (typeDistribution[typeName] || 0) + 1;

          newReports.push({
            domain: domainName,
            jobId: scanJobId,
            url: report.url,
            type: typeName,
            severity: issue.severity || 'Low',
            severityClass: sev === 'high' ? 'bg-danger bg-opacity-10 text-danger' : 
                           sev === 'medium' ? 'bg-warning bg-opacity-10 text-warning' : 
                           'bg-info bg-opacity-10 text-info',
            description: issue.description,
            suggestion: issue.suggestion,
            legalRisk: issue.legalRisk,
          });
        }
      }

      // Free memory
      delete report.html;
      delete report.bodyText;
    }

    // Calculate distributions
    const distributions = [];
    if (totalIssuesFound > 0) {
      for (const [type, count] of Object.entries(typeDistribution)) {
        distributions.push({
          type,
          percentage: Math.round((count / totalIssuesFound) * 100)
        });
      }
    }

    // Clear old reports for this domain NOW, so users see the old scan while scanning is in progress
    await DarkPatternReport.deleteMany({ domain: domainName });
    await DarkPatternSummary.deleteMany({ domain: domainName });

    // Insert new reports
    if (newReports.length > 0) {
      await DarkPatternReport.insertMany(newReports);
    }

    // Save summary
    await DarkPatternSummary.create({
      domain: domainName,
      jobId: scanJobId,
      totalPagesScanned: reports.length,
      totalDarkPatternsFound: totalIssuesFound,
      issuesBySeverity: severityCounts,
      distributions
    });

    logger.info(`✅ [${domainName}] Dark Pattern scan complete. Found ${totalIssuesFound} issues.`);
    
    // Update domain status to completed
    if (DomainModel) {
      if (sourceDomainDocId) {
        await DomainModel.findByIdAndUpdate(sourceDomainDocId, { 
          $set: { 
            dm_dark_pattern_status: 'completed',
            dm_dark_pattern_last_scan_at: new Date()
          } 
        });
      } else {
        await DomainModel.updateOne(
          { dm_url: domainName },
          { 
            $set: { 
              dm_dark_pattern_status: 'completed',
              dm_dark_pattern_last_scan_at: new Date()
            } 
          }
        );
      }
    }

    return { success: true, domainName, issues: totalIssuesFound };

  } catch (error) {
    logger.error(`[${domainName}] Dark Pattern scan failed: ${error.message}`);
    // Update domain status to failed
    if (DomainModel) {
      if (sourceDomainDocId) {
        await DomainModel.findByIdAndUpdate(sourceDomainDocId, { $set: { dm_dark_pattern_status: 'failed' } }).catch(() => {});
      } else {
        await DomainModel.updateOne(
          { dm_url: domainName },
          { $set: { dm_dark_pattern_status: 'failed' } }
        ).catch(() => {});
      }
    }
    throw error;
  }
};
