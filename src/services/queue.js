import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../utils/logger.js';
import { processScanDomain } from '../jobs/scanDomain.processor.js';
import { processInventoryScan } from '../jobs/inventoryScan.processor.js';
import { processQaScan } from '../jobs/qaScan.processor.js';
import { processAccessibilityScan } from '../jobs/accessibilityScan.processor.js';
import { runGlobalScan } from './orchestrator.service.js';

const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 50, 2000)
});

redisConnection.on('error', (err) => logger.error('Redis Connection Error:', err));

const QUEUE_NAME = process.env.QUEUE_NAME || 'seo-scan-queue';

export const seoScanQueue = new Queue(QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: false,
    timeout: 30 * 60 * 1000
  }
});

let lastFinishedDomain = null;
let lastFinishedAt = null;

export const initWorker = () => {
  const worker = new Worker(QUEUE_NAME, async (job) => {
    if (job.name === 'run-orchestrator') {
      logger.info(`[Job ${job.id}] 🚀 Executing scheduled global orchestration...`);
      return await runGlobalScan({ isStartup: false });
    }
    if (job.name === 'inventory-scan') {
      logger.info(`[Job ${job.id}] 📋 Starting inventory scan for: ${job.data.domainUrl}`);
      return await processInventoryScan(job);
    }
    if (job.name === 'qa-scan') {
      logger.info(`[Job ${job.id}] 🔎 Starting QA scan for: ${job.data.domainName}`);
      return await processQaScan(job);
    }
    if (job.name === 'accessibility-scan') {
      logger.info(`[Job ${job.id}] ♿ Starting Accessibility scan for: ${job.data.domainName}`);
      return await processAccessibilityScan(job);
    }
    logger.info(`[Job ${job.id}] 🔍 Starting scan for: ${job.data.domainName}`);
    return await processScanDomain(job);
  }, {
    connection: redisConnection,
    concurrency: parseInt(process.env.CONCURRENCY_LIMIT || '3', 10),
    lockDuration: 60 * 1000
  });

  worker.on('completed', (job) => {
    const target = job.name === 'run-orchestrator' ? 'Orchestrator' : job.data.domainName;
    logger.info(`Job ${job.id} (${target}) completed successfully.`);

    if (job.name === 'scan-domain') {
      lastFinishedDomain = job.data.domainName;
      lastFinishedAt = Date.now();
    }
  });
  worker.on('failed', (job, err) => {
    const target = job?.name === 'run-orchestrator' ? 'Orchestrator' : job?.data?.domainName || 'unknown';
    logger.error(`Job ${job?.id} (${target}) failed: ${err.message}`);
  });
  return worker;
};

export const clearQueue = async () => {
  try {
    await seoScanQueue.obliterate({ force: true });
    logger.info(`🧹 Queue "${QUEUE_NAME}" cleared recursively.`);
  } catch (error) {
    logger.error(`❌ Failed to clear queue: ${error.message}`);
  }
};

export const addScanJob = async (domainData) => {
  const { domainName, pageLimit, scanSubdomains, executeJs, sourceDb, sourceUri, sourceDomainDocId } = domainData;
  return await seoScanQueue.add('scan-domain', {
    domainName,
    pageLimit,
    scanSubdomains,
    executeJs,
    sourceDb,
    sourceUri,
    sourceDomainDocId
  });
};

export const addInventoryScanJob = async (jobData) => {
  const { domainId, domainUrl, scanId, sourceDb, sourceUri } = jobData;
  return await seoScanQueue.add('inventory-scan', {
    domainId,
    domainUrl,
    scanId,
    sourceDb,
    sourceUri
  });
};

export const addQaScanJob = async (jobData) => {
  const {
    domainName,
    pageLimit,
    scanSubdomains,
    executeJs,
    sourceDb,
    sourceUri,
    sourceDomainDocId,
  } = jobData;
  return await seoScanQueue.add('qa-scan', {
    domainName,
    pageLimit,
    scanSubdomains,
    executeJs,
    sourceDb,
    sourceUri,
    sourceDomainDocId,
  });
};

export const addAccessibilityScanJob = async (jobData) => {
  const {
    domainName,
    pageLimit,
    scanSubdomains,
    executeJs,
    sourceDb,
    sourceUri,
    sourceDomainDocId,
  } = jobData;
  return await seoScanQueue.add('accessibility-scan', {
    domainName,
    pageLimit,
    scanSubdomains,
    executeJs,
    sourceDb,
    sourceUri,
    sourceDomainDocId,
  });
};

/**
 * Ensures the repeatable orchestrator job is registered.
 * Runs every 1 minute.
 */
export const setupScheduledScans = async () => {
  const repeatIntervalMinutes = parseInt(process.env.SCAN_INTERVAL_MIN || '1', 10);

  const repeatInterval = repeatIntervalMinutes * 60 * 1000;

  // Clear existing jobs to prevent duplicates or ghost jobs (like yopmail.com)
  await clearQueue();

  await seoScanQueue.add('run-orchestrator', {}, {
    repeat: {
      every: repeatInterval,
    },
    jobId: 'global-orchestrator-repeatable'
  });

  logger.info(`⏰ Scheduled global orchestration every ${repeatInterval / 60000} minutes.`);
};

/**
 * Starts a live terminal countdown for the next orchestrator run.
 * Uses carriage return (\r) to update the same line in the terminal.
 */
