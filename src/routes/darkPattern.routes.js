import { Router } from 'express';
import { mongoMultiConnector } from '../services/mongoMultiConnector.js';
import { DarkPatternSummarySchema } from '../models/DarkPatternSummary.js';
import { DarkPatternReportSchema } from '../models/DarkPatternReport.js';
import { DomainSchema } from '../models/Domain.js';
import { addDarkPatternScanJob } from '../services/queue.js';
import { generateRemediationCode } from '../services/remediationService.js';
import { logger } from '../utils/logger.js';
import mongoose from 'mongoose';

const router = Router();

// Middleware to establish client DB connection
const useClientDb = async (req, res, next) => {
  const tenant = req.headers['tenant_id'];
  const clientDbName = tenant ? `tenant_${tenant}` : 'tenant_default';
  
  try {
    const dbUrl = process.env.DB_URL || 'mongodb://localhost:27017';
    req.dbConn = await mongoMultiConnector.getClientConnection(dbUrl, clientDbName);
    next();
  } catch (error) {
    logger.error(`Error connecting to client DB for tenant ${tenant}: ${error.message}`);
    res.status(500).json({ error: 'Database connection failed' });
  }
};

/**
 * Trigger a new Dark Pattern Scan for a domain
 * POST /api/dark-pattern/scan
 */
router.post('/scan', useClientDb, async (req, res) => {
  try {
    const { domainName, pageLimit, sourceDomainDocId } = req.body;
    if (!domainName) {
      return res.status(400).json({ error: 'domainName is required' });
    }

    const job = await addDarkPatternScanJob({
      domainName,
      pageLimit: pageLimit || 10,
      sourceDb: req.dbConn.name,
      sourceUri: process.env.DB_URL || 'mongodb://localhost:27017',
      sourceDomainDocId
    });

    const DomainModel = req.dbConn.model('Domain', DomainSchema, 'domains');
    
    // Accurately update the domain by ID if provided, otherwise fallback to URL
    if (sourceDomainDocId) {
      await DomainModel.findByIdAndUpdate(sourceDomainDocId, { $set: { dm_dark_pattern_status: 'scanning' } });
    } else {
      await DomainModel.updateOne(
        { dm_url: domainName },
        { $set: { dm_dark_pattern_status: 'scanning' } }
      );
    }

    res.json({ message: 'Dark Pattern scan started', jobId: job.id });
  } catch (error) {
    logger.error('Error triggering dark pattern scan:', error);
    res.status(500).json({ error: 'Failed to start scan' });
  }
});

/**
 * Generate remediation code for a specific dark pattern
 * POST /api/dark-pattern/remediation/generate
 */
router.post('/remediation/generate', useClientDb, async (req, res) => {
  try {
    const { type, description, suggestion } = req.body;
    
    if (!type || !description || !suggestion) {
      return res.status(400).json({ error: 'type, description, and suggestion are required' });
    }

    const code = await generateRemediationCode(type, description, suggestion);
    res.json({ code });
  } catch (error) {
    logger.error('Error generating remediation code:', error);
    res.status(500).json({ error: 'Failed to generate code' });
  }
});

/**
 * Get domain summary
 * GET /api/dark-pattern/summary/:domainName
 */
router.get('/summary/:domainName', useClientDb, async (req, res) => {
  try {
    const DarkPatternSummary = req.dbConn.model('DarkPatternSummary', DarkPatternSummarySchema);
    
    // Get the latest summary for this domain
    const summary = await DarkPatternSummary.findOne({ domain: req.params.domainName })
      .sort({ scanDate: -1 })
      .lean();
      
    // Fetch last 5 scans for the history chart
    const history = await DarkPatternSummary.find({ domain: req.params.domainName })
      .sort({ scanDate: -1 })
      .limit(5)
      .select('scanDate totalDarkPatternsFound')
      .lean();
      
    if (!summary) {
      // Return a blank structure if no scan has run yet
      return res.json({
        domain: req.params.domainName,
        totalPagesScanned: 0,
        totalDarkPatternsFound: 0,
        issuesBySeverity: { high: 0, medium: 0, low: 0 },
        distributions: [],
        history: []
      });
    }

    summary.history = history.reverse(); // reverse so chronological order (left to right)
    res.json(summary);
  } catch (error) {
    logger.error('Error fetching dark pattern summary:', error);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

/**
 * Get page-level issues
 * GET /api/dark-pattern/issues/:domainName
 */
router.get('/issues/:domainName', useClientDb, async (req, res) => {
  try {
    const DarkPatternReport = req.dbConn.model('DarkPatternReport', DarkPatternReportSchema);
    
    // Get all issues for the domain (you might want to filter by jobId of the latest scan eventually)
    const issues = await DarkPatternReport.find({ domain: req.params.domainName })
      .sort({ severity: 1, type: 1 })
      .lean();
      
    res.json(issues);
  } catch (error) {
    logger.error('Error fetching dark pattern issues:', error);
    res.status(500).json({ error: 'Failed to fetch issues' });
  }
});

export default router;
