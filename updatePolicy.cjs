const mongoose = require('mongoose');
const DB_URL_BASE = 'mongodb+srv://sitemonitor26_db_user:lbbxaH2mDEHLyitL@cluster0.ev4p3qf.mongodb.net/';
const OPTS = '?retryWrites=true&w=majority';

async function updateDb(dbName) {
  const url = DB_URL_BASE + dbName + OPTS;
  const conn = await mongoose.createConnection(url).asPromise();
  
  const Policy = conn.model('Policy', new mongoose.Schema({}, { strict: false, collection: 'policies' }));
  const result = await Policy.updateMany(
    { title: /Sample Policy/ },
    { $set: { is_deleted: false, is_active: true } }
  );
  console.log('Updated in ' + dbName + ':', result.modifiedCount);
  await conn.close();
}

async function run() {
  await updateDb('tenant_omunim');
  await updateDb('tenant_sbi');
  process.exit();
}

run().catch(console.error);
