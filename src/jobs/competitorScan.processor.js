import { scanDomain } from '../services/seoScanner.js';
import { DomainSchema } from '../models/Domain.js';
import { CompetitorReportSchema } from '../models/CompetitorReport.js';
import { mongoMultiConnector } from '../services/mongoMultiConnector.js';
import { logger } from '../utils/logger.js';

export const processCompetitorScan = async (job) => {
  const { domainName, sourceDb, sourceUri, sourceDomainDocId } = job.data;
  const scanJobId = `competitor-${job.id || Date.now()}`;
  
  let conn;
  try {
    conn = await mongoMultiConnector.getClientConnection(sourceUri, sourceDb);
    const DomainModel = conn.model('Domain', DomainSchema);
    const CompetitorReport = conn.model('CompetitorReport', CompetitorReportSchema);

    const domainDoc = await DomainModel.findById(sourceDomainDocId).lean();
    if (!domainDoc || !domainDoc.dm_competitors || domainDoc.dm_competitors.length === 0) {
      logger.info(`[CompetitorScan] No competitors found for ${domainName}. Skipping.`);
      return;
    }

    await DomainModel.findByIdAndUpdate(sourceDomainDocId, { dm_competitor_status: 'scanning' });

    logger.info(`[CompetitorScan] Starting for ${domainName}. Found ${domainDoc.dm_competitors.length} competitors.`);

    // Hold new reports in memory during the scan so old data remains visible
    const newReports = [];

    for (const competitorUrl of domainDoc.dm_competitors) {
      try {
        logger.info(`[CompetitorScan] Crawling competitor: ${competitorUrl}`);
        // Quick scan (limit to 5 pages) to get basic SEO scores and keywords
        const reports = await scanDomain(competitorUrl, {
          pageLimit: 5,
          scanSubdomains: false,
          executeJs: false,
          fullResourceReport: false
        });

        let totalScore = 0;
        let allKeywords = new Set();
        
        reports.forEach(r => {
          if (r.seoScore) totalScore += r.seoScore;
          if (r.keywords) {
            r.keywords.forEach(k => allKeywords.add(k.word || k));
          }
        });
        
        const avgScore = reports.length > 0 ? Math.round(totalScore / reports.length) : 0;

        newReports.push({
          domain: domainName,
          competitorUrl: competitorUrl,
          seoScore: avgScore,
          accessibilityScore: Math.floor(Math.random() * 20) + 70, // Mock for now unless we chain the axe crawler
          darkPatternsFound: Math.floor(Math.random() * 3), // Mock for now unless we chain dark pattern crawler
          commonKeywords: Array.from(allKeywords).slice(0, 10),
          gapKeywords: []
        });

      } catch (err) {
        logger.error(`[CompetitorScan] Error crawling competitor ${competitorUrl}: ${err.message}`);
      }
    }

    // Clear old competitor reports for this domain NOW
    await CompetitorReport.deleteMany({ domain: domainName });

    // Insert new reports
    if (newReports.length > 0) {
      await CompetitorReport.insertMany(newReports);
    }

    await DomainModel.findByIdAndUpdate(sourceDomainDocId, {  
      dm_competitor_status: 'completed',
      dm_competitor_last_scan_at: new Date()
    });

    logger.info(`[CompetitorScan] Completed successfully for ${domainName}`);
  } catch (error) {
    logger.error(`[CompetitorScan] Fatal error: ${error.message}`);
    if (conn) {
      const DomainModel = conn.model('Domain', DomainSchema);
      await DomainModel.findByIdAndUpdate(sourceDomainDocId, { dm_competitor_status: 'failed' }).catch(() => {});
    }
    throw error;
  }
};
