import { scanDomain } from '../services/seoScanner.js';
import { runQaScan } from '../services/qaScanner.js';
import { DomainSchema } from '../models/Domain.js';
import { ActivityLogSchema } from '../models/ActivityLog.js';
import { mongoMultiConnector } from '../services/mongoMultiConnector.js';
import { logger } from '../utils/logger.js';

/**
 * Standalone QA scan job – crawls domain then persists QA reports.
 * Domain SEO scan also runs QA inline after crawl (see scanDomain.processor.js).
 */
export const processQaScan = async (job) => {
  const {
    domainName,
    pageLimit,
    scanSubdomains,
    executeJs,
    fullResourceReport,
    sourceDb,
    sourceUri,
    sourceDomainDocId,
  } = job.data;
  const startTime = Date.now();
  const scanJobId = `qa-${job.id || 'job'}-${Date.now()}`;

  let conn;
  let DomainModel;

  try {
    if (!sourceUri || !sourceDb) {
      throw new Error(`Missing connection info for domain ${domainName}`);
    }

    conn = await mongoMultiConnector.getClientConnection(sourceUri, sourceDb);
    DomainModel = conn.model('Domain', DomainSchema);

    if (sourceDomainDocId) {
      await DomainModel.findByIdAndUpdate(sourceDomainDocId, {
        dm_qa_status: 'scanning',
        dm_updated_at: new Date(),
      });
    }

    const domainDoc = sourceDomainDocId
      ? await DomainModel.findById(sourceDomainDocId).lean()
      : null;

    logger.info(`[${domainName}] Starting standalone QA crawl (job ${scanJobId})...`);
    const reports = await scanDomain(domainName, {
      pageLimit: pageLimit || 500,
      scanSubdomains: scanSubdomains ?? true,
      executeJs: executeJs ?? false,
      fullResourceReport: fullResourceReport ?? true,
      customUrls: domainDoc?.dm_custom_urls || job.data.dm_custom_urls,
    });

    reports.forEach((report) => {
      delete report.html;
      delete report.bodyText;
    });

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

    if (sourceDomainDocId) {
      await DomainModel.findByIdAndUpdate(sourceDomainDocId, {
        dm_qa_status: 'completed',
        dm_qa_last_scan_at: new Date(),
        dm_updated_at: new Date(),
      });

      // Log activity
      try {
        const ActivityLogModel = conn.model('ActivityLog', ActivityLogSchema);
        await ActivityLogModel.create({
          action: 'SCAN_COMPLETED',
          details: `QA scan completed successfully for domain '${domainName}'. Crawled ${reports.length} pages.`,
          metadata: {
            domainId: sourceDomainDocId,
            domainName,
            scanType: 'qa',
            pagesScanned: reports.length,
            durationMs: Date.now() - startTime
          }
        });
      } catch (logErr) {
        logger.warn(`Could not log QA scan completion to ActivityLog: ${logErr.message}`);
      }
    }

    const durationMs = Date.now() - startTime;
    logger.info(`✅ QA scan completed for ${domainName} in ${durationMs}ms (${reports.length} pages)`);
    return { success: true, pagesScanned: reports.length, durationMs, jobId: scanJobId };
  } catch (err) {
    logger.error(`QA scan error for ${domainName}: ${err.message}`);
    if (sourceDomainDocId && DomainModel) {
      try {
        await DomainModel.findByIdAndUpdate(sourceDomainDocId, {
          dm_qa_status: 'failed',
          dm_updated_at: new Date(),
        });

        // Log activity
        try {
          const ActivityLogModel = conn.model('ActivityLog', ActivityLogSchema);
          await ActivityLogModel.create({
            action: 'SCAN_FAILED',
            details: `QA scan failed for domain '${domainName}': ${err.message}`,
            metadata: {
              domainId: sourceDomainDocId,
              domainName,
              scanType: 'qa',
              error: err.message
            }
          });
        } catch (logErr) {
          logger.warn(`Could not log QA scan failure to ActivityLog: ${logErr.message}`);
        }
      } catch (updateErr) {
        logger.warn(`Could not set QA status to failed: ${updateErr.message}`);
      }
    }
    throw err;
  }
};
