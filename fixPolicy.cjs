const mongoose = require('mongoose');
const DB_URL_BASE = 'mongodb+srv://sitemonitor26_db_user:lbbxaH2mDEHLyitL@cluster0.ev4p3qf.mongodb.net/';
const OPTS = '?retryWrites=true&w=majority';

async function fixDb(dbName) {
  const url = DB_URL_BASE + dbName + OPTS;
  const conn = await mongoose.createConnection(url).asPromise();
  
  const Policy = conn.model('Policy', new mongoose.Schema({}, { strict: false, collection: 'policies' }));
  const policies = await Policy.find({ title: /Sample Policy/ });
  
  let count = 0;
  for (const p of policies) {
    let changed = false;
    
    // Fix domainIds
    if (p.domainIds && p.domainIds.length > 0) {
      for (let i = 0; i < p.domainIds.length; i++) {
        if (typeof p.domainIds[i] === 'string') {
          p.domainIds[i] = new mongoose.Types.ObjectId(p.domainIds[i]);
          changed = true;
        }
      }
    }
    
    // Fix rule ids
    if (p.rules && p.rules.length > 0) {
      for (let i = 0; i < p.rules.length; i++) {
        if (!p.rules[i].id) {
          p.rules[i].id = Date.now() + i;
          changed = true;
        }
      }
    }
    
    // Fix category
    if (p.category !== 'required' && p.category !== 'matches' && p.category !== 'unwanted') {
      p.category = 'required';
      changed = true;
    }
    
    if (changed) {
      await Policy.updateOne({ _id: p._id }, { $set: { domainIds: p.domainIds, rules: p.rules, category: p.category } });
      count++;
    }
  }
  console.log('Fixed ' + count + ' policies in ' + dbName);
  await conn.close();
}

async function run() {
  await fixDb('tenant_omunim');
  await fixDb('tenant_sbi');
  process.exit();
}

run().catch(console.error);
