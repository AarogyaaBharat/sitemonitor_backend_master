import mongoose from 'mongoose';
import { DomainSchema } from '../src/models/Domain.js';

const DB_URL = "mongodb+srv://sitemonitor26_db_user:lbbxaH2mDEHLyitL@cluster0.ev4p3qf.mongodb.net/?appName=Cluster0";
const CLIENT_DB = "tenant_sbi";

async function run() {
  try {
    console.log("Connecting to", CLIENT_DB);
    const conn = await mongoose.createConnection(DB_URL, {
      dbName: CLIENT_DB
    }).asPromise();
    
    const Domain = conn.model('Domain', DomainSchema, 'domains');
    const domains = await Domain.find({});
    console.log(`Found ${domains.length} domains in tenant_sbi:`);
    for (const d of domains) {
      console.log(`- ID: ${d._id}, dm_id: ${d.dm_id}, URL: ${d.dm_url}, Title: ${d.dm_title}, Status: ${d.dm_status}, SEO Status: ${d.dm_seo_status}, Deleted: ${d.dm_is_deleted}, Archived: ${d.dm_is_archived}`);
    }
    
    await conn.close();
  } catch (err) {
    console.error("Error running script:", err);
  }
}

run();
