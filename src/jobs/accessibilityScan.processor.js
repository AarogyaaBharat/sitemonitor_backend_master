import { scanDomain } from '../services/seoScanner.js';
import { runAccessibilityScan } from '../services/accessibilityScanner.js';
import { DomainSchema } from '../models/Domain.js';
import { ActivityLogSchema } from '../models/ActivityLog.js';
import { mongoMultiConnector } from '../services/mongoMultiConnector.js';
import { logger } from '../utils/logger.js';

/**
 * Standalone Accessibility scan job – crawls domain then persists Accessibility reports.
 * Domain SEO scan also runs Accessibility inline after crawl (see scanDomain.processor.js).
 */
export const processAccessibilityScan = async (job) => {
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
  const scanJobId = `accessibility-${job.id || 'job'}-${Date.now()}`;

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
        dm_accessibility_status: 'scanning',
        dm_updated_at: new Date(),
      });
    }

    logger.info(`[${domainName}] Starting standalone Accessibility crawl (job ${scanJobId})...`);
    
    // Perform initial crawl to get pages to scan
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

    // Run Axe-core on the discovered pages
    await runAccessibilityScan(domainName, reports, scanJobId, conn);

    if (sourceDomainDocId) {
      await DomainModel.findByIdAndUpdate(sourceDomainDocId, {
        dm_accessibility_status: 'completed',
        dm_accessibility_last_scan_at: new Date(),
        dm_updated_at: new Date(),
      });

      // Log activity
      try {
        const ActivityLogModel = conn.model('ActivityLog', ActivityLogSchema);
        await ActivityLogModel.create({
          action: 'SCAN_COMPLETED',
          details: `Accessibility scan completed successfully for domain '${domainName}'. Checked ${reports.length} pages.`,
          metadata: {
            domainId: sourceDomainDocId,
            domainName,
            scanType: 'accessibility',
            pagesScanned: reports.length,
            durationMs: Date.now() - startTime
          }
        });
      } catch (logErr) {
        logger.warn(`Could not log accessibility scan completion to ActivityLog: ${logErr.message}`);
      }
    }

    const durationMs = Date.now() - startTime;
    logger.info(`✅ Accessibility scan completed for ${domainName} in ${durationMs}ms (${reports.length} pages)`);
    return { success: true, pagesScanned: reports.length, durationMs, jobId: scanJobId };
  } catch (err) {
    logger.error(`Accessibility scan error for ${domainName}: ${err.message}`);
    if (sourceDomainDocId && DomainModel) {
      try {
        await DomainModel.findByIdAndUpdate(sourceDomainDocId, {
          dm_accessibility_status: 'failed',
          dm_updated_at: new Date(),
        });

        // Log activity
        try {
          const ActivityLogModel = conn.model('ActivityLog', ActivityLogSchema);
          await ActivityLogModel.create({
            action: 'SCAN_FAILED',
            details: `Accessibility scan failed for domain '${domainName}': ${err.message}`,
            metadata: {
              domainId: sourceDomainDocId,
              domainName,
              scanType: 'accessibility',
              error: err.message
            }
          });
        } catch (logErr) {
          logger.warn(`Could not log accessibility scan failure to ActivityLog: ${logErr.message}`);
        }
      } catch (updateErr) {
        logger.warn(`Could not set Accessibility status to failed: ${updateErr.message}`);
      }
    }
    throw err;
  }
};
