import mongoose from 'mongoose';
import { TenantSchema } from '../models/Tenant.js';
import { DomainSchema } from '../models/Domain.js';
import { mongoMultiConnector } from './mongoMultiConnector.js';
import { addScanJob, clearQueue } from './queue.js';
import { logger } from '../utils/logger.js';

/**
 * Orchestrates domain scans across all active tenants.
 * Fetches tenants from the master database, then for each tenant,
 * connects to their client database and enqueues scan jobs for their domains.
 * 
 * @param {Object} options - Orchestration options.
 * @param {string|null} options.tenantName - Optional specific tenant name to scan.
 * @param {boolean} options.isStartup - If true, resets and enqueues domains that were 'scanning'.
 * @param {number} options.staleThresholdMin - Minutes before a 'scanning' job is considered stuck.
 */

/**
 * Startup Recovery: Resets any domains stuck in a 'scanning' state back to 'pending'.
 * This runs when the server boots to handle jobs interrupted by a crash or restart.
 */
export const resetStuckScans = async () => {
    logger.info(`Orchestrator: Initiating startup recovery for stuck scans...`);
    const dbUrl = process.env.DB_URL || 'mongodb://localhost:27017';
    let masterConn;
    let totalReset = 0;

    try {
        masterConn = await mongoose.createConnection(dbUrl, {
            dbName: 'master',
            maxPoolSize: 5,
        }).asPromise();

        const Tenant = masterConn.model('Tenant', TenantSchema);
        const tenants = await Tenant.find({ tent_status: 'active', tent_is_deleted: false });

        for (const tenant of tenants) {
            const clientDbName = `tenant_${tenant.tent_name}`;
            try {
                const clientConn = await mongoMultiConnector.getClientConnection(dbUrl, clientDbName);
                const Domain = clientConn.model('Domain', DomainSchema, 'domains');

                const updateResult = await Domain.updateMany(
                    {
                        $or: [
                            { dm_seo_status: 'scanning' },
                            { dm_qa_status: 'scanning' },
                            { dm_accessibility_status: 'scanning' },
                            { dm_policy_status: 'scanning' },
                            { dm_dark_pattern_status: 'scanning' },
                            { dm_competitor_status: 'scanning' }
                        ]
                    },
                    {
                        $set: {
                            dm_seo_status: 'pending',
                            dm_qa_status: 'pending',
                            dm_accessibility_status: 'pending',
                            dm_policy_status: 'pending',
                            dm_dark_pattern_status: 'pending',
                            dm_competitor_status: 'pending',
                            dm_updated_at: new Date()
                        }
                    }
                );

                if (updateResult.modifiedCount > 0) {
                    logger.info(`Orchestrator: Recovered ${updateResult.modifiedCount} stuck domains for tenant ${tenant.tent_name}.`);
                    totalReset += updateResult.modifiedCount;
                }
            } catch (err) {
                logger.error(`Orchestrator: Failed to recover domains for tenant ${tenant.tent_name}: ${err.message}`);
            }
        }
    } catch (error) {
        logger.error(`Orchestrator: Critical error during startup recovery: ${error.message}`);
    } finally {
        if (masterConn) {
            await masterConn.close();
        }
    }
    logger.info(`✅ Orchestrator: Startup recovery complete. Reset ${totalReset} stuck domains.`);
};

export const runGlobalScan = async (options = {}) => {
    const { tenantName = null, isStartup = false, staleThresholdMin = 30 } = options;
    
    logger.info(`Orchestrator: Starting global scan orchestration... ${isStartup ? '[STARTUP MODE]' : ''}`);

    // 0. (Removed clearQueue here to allow repeatable jobs and persistence)
    // await clearQueue();

    // 1. Connect to Master DB
    const dbUrl = process.env.DB_URL || 'mongodb://localhost:27017';
    
    logger.info(`🔗 Connecting to MASTER database: master`);
    let masterConn;
    let totalEnqueued = 0;
    try {
        masterConn = await mongoose.createConnection(dbUrl, {
            dbName: 'master',
            maxPoolSize: 5,
        }).asPromise();

        const Tenant = masterConn.model('Tenant', TenantSchema);

        // 2. Fetch Tenants
        const query = { tent_status: 'active', tent_is_deleted: false };
        if (tenantName) {
            query.tent_name = tenantName.toLowerCase();
            logger.info(`Orchestrator: Filtering for tenant "${tenantName}"`);
        }

        const tenants = await Tenant.find(query);
        logger.info(`Orchestrator: Found ${tenants.length} tenants to process.`);


        for (const tenant of tenants) {
            const clientDbName = `tenant_${tenant.tent_name}`;
            logger.info(`📁 Switching to CLIENT database: ${clientDbName} (Tenant: ${tenant.tent_name})`);

            // 3. Connect to Client DB

            try {
                const clientConn = await mongoMultiConnector.getClientConnection(dbUrl, clientDbName);
                const Domain = clientConn.model('Domain', DomainSchema, 'domains');

                const now = new Date();
                const staleDate = new Date(Date.now() - staleThresholdMin * 60 * 1000);

                const domains = await Domain.find({
                    dm_status: 'active',
                    dm_is_deleted: false,
                    dm_is_archived: { $ne: true },
                    $or: [
                        { dm_seo_status: 'pending' },
                        { dm_next_scan_at: { $lte: now } },
                        { dm_next_scan_at: { $exists: false } }, // Fallback for old data
                        {
                            dm_seo_status: 'failed',
                            dm_last_scan_at: { $lte: new Date(Date.now() - 2 * 60 * 1000) }
                        },
                        // Include scanning domains if we're starting up OR if they've been scanning too long
                        {
                            dm_seo_status: 'scanning',
                            $or: [
                                { _id: { $exists: isStartup } }, // If isStartup is true, this matches all
                                { dm_updated_at: { $lte: staleDate } }
                            ]
                        }
                    ]
                });

                if (domains.length === 0) {
                    logger.info(`Orchestrator: No domains found for tenant ${tenant.tent_name} (excluding those currently scanning).`);
                    continue;
                }

                logger.info(`Orchestrator: Found ${domains.length} domains for tenant ${tenant.tent_name}. Enqueueing jobs...`);

                for (const domain of domains) {
                    await addScanJob({
                        domainName: domain.dm_url,
                        pageLimit: domain.dm_max_scanned_pages || 500,
                        scanSubdomains: domain.dm_scan_subdomains ?? true,
                        executeJs: domain.dm_render_pages_execute_js ?? false,
                        fullResourceReport: domain.dm_store_all_resources ?? true,
                        sourceDb: clientDbName,
                        sourceUri: dbUrl,
                        sourceDomainDocId: domain._id,
                        dm_custom_urls: domain.dm_custom_urls
                    });

                    // Immediately mark as scanning to avoid duplicate enqueuing in the next orchestrator tick
                    try {
                        await Domain.findByIdAndUpdate(domain._id, { 
                            dm_seo_status: 'scanning',
                            dm_updated_at: new Date() 
                        });
                    } catch (err) {
                        logger.warn(`Orchestrator: Could not mark domain ${domain.dm_url} as scanning: ${err.message}`);
                    }

                    totalEnqueued++;
                    logger.info(`  [${totalEnqueued}] Enqueued: ${domain.dm_url}`);
                }
            } catch (error) {
                logger.error(`Orchestrator: Error connecting to or processing client DB for "${tenant.tent_name}": ${error.message}`);
            }
        }
    } catch (error) {
        logger.error(`Orchestrator: Critical error in global scan: ${error.message}`);
        throw error;
    } finally {
        if (masterConn) {
            await masterConn.close();
            logger.info('Orchestrator: Master DB connection closed.');
        }
    }

    logger.info(`✅ Orchestrator: Finished. Total jobs enqueued: ${totalEnqueued || 0}`);
};
