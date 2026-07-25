import { Router } from 'express';
import { mongoMultiConnector } from '../services/mongoMultiConnector.js';
import { CompetitorReportSchema } from '../models/CompetitorReport.js';
import { DomainSchema } from '../models/Domain.js';
import { addCompetitorScanJob } from '../services/queue.js';
import { logger } from '../utils/logger.js';

const router = Router();

const useClientDb = async (req, res, next) => {
  const tenant = req.headers['tenant_id'];
  const clientDbName = tenant ? `tenant_${tenant}` : 'tenant_default';
  
  try {
    const dbUrl = process.env.DB_URL || 'mongodb://localhost:27017';
    req.dbConn = await mongoMultiConnector.getClientConnection(dbUrl, clientDbName);
    next();
  } catch (error) {
    res.status(500).json({ error: 'Database connection failed' });
  }
};

router.post('/scan', useClientDb, async (req, res) => {
  try {
    const { domainName, sourceDomainDocId } = req.body;
    if (!domainName || !sourceDomainDocId) return res.status(400).json({ error: 'domainName and sourceDomainDocId required' });

    const job = await addCompetitorScanJob({
      domainName,
      sourceDb: req.dbConn.name,
      sourceUri: process.env.DB_URL || 'mongodb://localhost:27017',
      sourceDomainDocId
    });
    res.json({ message: 'Competitor scan started', jobId: job.id });
  } catch (error) {
    logger.error('Error starting competitor scan:', error);
    res.status(500).json({ error: 'Failed to start' });
  }
});

router.post('/add', useClientDb, async (req, res) => {
  try {
    const { sourceDomainDocId, competitorUrl } = req.body;
    if (!competitorUrl) return res.status(400).json({ error: 'competitorUrl required' });

    const DomainModel = req.dbConn.model('Domain', DomainSchema);
    await DomainModel.findByIdAndUpdate(sourceDomainDocId, { 
      $addToSet: { dm_competitors: competitorUrl }
    });
    res.json({ message: 'Competitor added successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add' });
  }
});

router.post('/remove', useClientDb, async (req, res) => {
  try {
    const { sourceDomainDocId, competitorUrl } = req.body;
    const DomainModel = req.dbConn.model('Domain', DomainSchema);
    await DomainModel.findByIdAndUpdate(sourceDomainDocId, { 
      $pull: { dm_competitors: competitorUrl }
    });
    res.json({ message: 'Competitor removed successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove' });
  }
});

router.get('/reports/:domainName', useClientDb, async (req, res) => {
  try {
    const CompetitorReport = req.dbConn.model('CompetitorReport', CompetitorReportSchema);
    const reports = await CompetitorReport.find({ domain: req.params.domainName }).lean();
    res.json(reports);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch' });
  }
});

export default router;
