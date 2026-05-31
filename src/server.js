import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import mongoose from 'mongoose';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter.js';
import { ExpressAdapter } from '@bull-board/express';


import { logger } from './utils/logger.js';

import scanRoutes from './routes/scan.routes.js';
import { mongoMultiConnector } from './services/mongoMultiConnector.js';
import { seoScanQueue, initWorker, setupScheduledScans } from './services/queue.js';
import { runGlobalScan } from './services/orchestrator.service.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Env Validation
const requiredEnv = ['REDIS_URL'];
const missing = requiredEnv.filter(k => !process.env[k]);
if (missing.length > 0) {
  logger.error(`FATAL: Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());



// BullBoard Queue Dashboard
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');
createBullBoard({
  queues: [new BullMQAdapter(seoScanQueue)],
  serverAdapter: serverAdapter,
});
app.use('/admin/queues', serverAdapter.getRouter());
logger.info(`BullBoard dashboard available at http://localhost:${PORT}/admin/queues`);

// Routes
app.use('/scan', scanRoutes);

// Database Connection & Server Start
const startServer = async () => {
  try {


    initWorker();
    logger.info('SEO Scan Worker initialized.');

    await setupScheduledScans();

    const server = app.listen(PORT, () => {
      logger.info(`SEO Scanner Service running on port ${PORT}`);
      
      // Trigger global scan on startup if enabled
      if (process.env.SCAN_ON_STARTUP === 'true') {
        logger.info('🚀 SCAN_ON_STARTUP is enabled. Triggering global orchestration...');
        runGlobalScan({ isStartup: true })
          .then(() => logger.info('✅ Initial global scan orchestration completed.'))
          .catch(err => logger.error(`❌ Error during initial global scan: ${err.message}`));
      } else {
        logger.info('ℹ️ SCAN_ON_STARTUP is disabled. Skipping automatic scan.');
      }
    });

    const shutdown = async (signal) => {
      logger.info(`${signal} signal received. Closing resources...`);
      server.close();
      await mongoMultiConnector.closeAll();
      await seoScanQueue.close();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    logger.error(`Critical error during startup: ${error.message}`);
    process.exit(1);
  }
};

startServer();
