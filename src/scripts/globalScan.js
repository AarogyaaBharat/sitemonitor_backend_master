import 'dotenv/config';
import { runGlobalScan } from '../services/orchestrator.service.js';
import { logger } from '../utils/logger.js';
import process from 'process';

const start = async () => {
    try {
        const tenantName = process.argv[2] || null;
        await runGlobalScan(tenantName);
        
        logger.info('Global scan script completed successfully.');
        process.exit(0);
    } catch (error) {
        logger.error(`Global scan script failed: ${error.message}`);
        process.exit(1);
    }
};

start();
