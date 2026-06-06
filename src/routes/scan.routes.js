import express from 'express';
import { addScanJob, addInventoryScanJob, addQaScanJob, addAccessibilityScanJob, seoScanQueue } from '../services/queue.js';
import { mongoMultiConnector } from '../services/mongoMultiConnector.js';
import { logger } from '../utils/logger.js';
import mongoose from 'mongoose';

const router = express.Router();


router.post('/trigger', async (req, res) => {
  try {
    const connections = JSON.parse(process.env.MONGODB_CONNECTIONS || '[]');
    const pendingDomains = await mongoMultiConnector.fetchAllPendingDomains(connections);
    const jobs = [];
    for (const domain of pendingDomains) {
      const job = await addScanJob({
        domainName: domain.dm_url,
        pageLimit: domain.dm_max_scanned_pages,
        scanSubdomains: domain.dm_scan_subdomains,
        executeJs: domain.dm_render_pages_execute_js,
        sourceDb: domain.sourceDb,
        sourceUri: domain.sourceUri,
        sourceDomainDocId: domain._id
      });
      jobs.push({ domain: domain.dm_url, jobId: job.id });
    }
    res.json({ message: `Enqueued ${jobs.length} domains`, jobs });
  } catch (error) {
    logger.error(`Failed to trigger scans: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});


router.post('/domain', async (req, res) => {
  const { dm_url, dm_max_scanned_pages, dm_scan_subdomains, dm_render_pages_execute_js, sourceDb, sourceUri, sourceDomainDocId } = req.body;
  if (!dm_url) return res.status(400).json({ error: 'dm_url is required' });
  try {
    const job = await addScanJob({ 
        domainName: dm_url, 
        pageLimit: dm_max_scanned_pages || 500,
        scanSubdomains: dm_scan_subdomains ?? true,
        executeJs: dm_render_pages_execute_js ?? false,
        sourceDb,
        sourceUri,
        sourceDomainDocId
    });
    res.json({ success: true, message: 'Job enqueued', jobId: job.id });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.post('/qa', async (req, res) => {
  const {
    dm_url,
    dm_max_scanned_pages,
    dm_scan_subdomains,
    dm_render_pages_execute_js,
    sourceDb,
    sourceUri,
    sourceDomainDocId,
  } = req.body;
  if (!dm_url) return res.status(400).json({ error: 'dm_url is required' });
  if (!sourceDb || !sourceUri) {
    return res.status(400).json({ error: 'sourceDb and sourceUri are required' });
  }
  try {
    const job = await addQaScanJob({
      domainName: dm_url,
      pageLimit: dm_max_scanned_pages || 500,
      scanSubdomains: dm_scan_subdomains ?? true,
      executeJs: dm_render_pages_execute_js ?? false,
      fullResourceReport: true,
      sourceDb,
      sourceUri,
      sourceDomainDocId,
    });
    res.json({ success: true, message: 'QA scan job enqueued', jobId: job.id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/accessibility', async (req, res) => {
  const {
    dm_url,
    dm_max_scanned_pages,
    dm_scan_subdomains,
    dm_render_pages_execute_js,
    sourceDb,
    sourceUri,
    sourceDomainDocId,
  } = req.body;
  if (!dm_url) return res.status(400).json({ error: 'dm_url is required' });
  if (!sourceDb || !sourceUri) {
    return res.status(400).json({ error: 'sourceDb and sourceUri are required' });
  }
  try {
    const job = await addAccessibilityScanJob({
      domainName: dm_url,
      pageLimit: dm_max_scanned_pages || 500,
      scanSubdomains: dm_scan_subdomains ?? true,
      executeJs: dm_render_pages_execute_js ?? false,
      fullResourceReport: true,
      sourceDb,
      sourceUri,
      sourceDomainDocId,
    });
    res.json({ success: true, message: 'Accessibility scan job enqueued', jobId: job.id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/inventory', async (req, res) => {
  const { domainId, domainUrl, scanId, sourceDb, sourceUri } = req.body;
  if (!domainId || !domainUrl || !scanId || !sourceDb || !sourceUri) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }
  try {
    const job = await addInventoryScanJob({ domainId, domainUrl, scanId, sourceDb, sourceUri });
    res.json({ success: true, message: 'Inventory scan job enqueued', jobId: job.id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/jobs', async (req, res) => {
  try {
    const jobs = await seoScanQueue.getJobs(['active', 'waiting', 'completed', 'failed', 'delayed']);
    res.json(jobs.map(j => ({ id: j.id, name: j.name, status: j.status, timestamp: new Date(j.timestamp).toISOString() })));
  } catch (error) { res.status(500).json({ error: error.message }); }
});

router.get('/health', async (req, res) => {
  const health = { uptime: process.uptime(), redis: 'unknown', mongo: 'unknown' };
  try { health.redis = (await seoScanQueue.client).status; } catch (e) {}
  health.mongo = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.json(health);
});

export default router;
