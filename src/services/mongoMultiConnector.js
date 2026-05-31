import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';
import { DomainSchema } from '../models/Domain.js';

class MongoMultiConnector {
  constructor() {
    this.clientConnections = new Map();
  }



  async getClientConnection(uri, dbName) {
    const key = `${uri}-${dbName}`;
    if (this.clientConnections.has(key)) {
      return this.clientConnections.get(key);
    }

    try {
      const conn = mongoose.createConnection(uri, {
        dbName,
        maxPoolSize: 5,
      });
      
      await new Promise((resolve, reject) => {
        conn.once('open', resolve);
        conn.once('error', reject);
      });

      this.clientConnections.set(key, conn);
      logger.info(`✅ Successfully connected to database: ${dbName}`);
      return conn;
    } catch (error) {
      logger.error(`Failed to connect to CLIENT database ${dbName}: ${error.message}`);
      throw error;
    }
  }

  async fetchAllPendingDomains(connections) {
    const allPending = [];
    for (const config of connections) {
      try {
        const conn = await this.getClientConnection(config.uri, config.dbName);
        const DomainModel = conn.model('Domain', DomainSchema, 'domains');
        const pending = await DomainModel.find({ dm_status: 'active', dm_is_deleted: false }).lean();
        allPending.push(...pending.map(d => ({
          ...d,
          sourceDb: config.dbName,
          sourceUri: config.uri
        })));
      } catch (error) {
        logger.error(`Error fetching pending domains from ${config.dbName}: ${error.message}`);
      }
    }
    return allPending;
  }

  async closeAll() {
    for (const conn of this.clientConnections.values()) {
      await conn.close();
    }
    logger.info('All MongoDB connections closed.');
  }
}

export const mongoMultiConnector = new MongoMultiConnector();
