import { scanDomain } from '../services/seoScanner.js';
import { runQaScan } from '../services/qaScanner.js';
import { DomainSchema } from '../models/Domain.js';
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
      } catch (updateErr) {
        logger.warn(`Could not set QA status to failed: ${updateErr.message}`);
      }
    }
    throw err;
  }
};
