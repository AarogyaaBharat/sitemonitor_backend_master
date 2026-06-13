const mongoose = require('mongoose');
const DB_URL_BASE = 'mongodb+srv://sitemonitor26_db_user:lbbxaH2mDEHLyitL@cluster0.ev4p3qf.mongodb.net/';
const OPTS = '?retryWrites=true&w=majority';

async function fixDb(dbName) {
  const url = DB_URL_BASE + dbName + OPTS;
  const conn = await mongoose.createConnection(url).asPromise();
  
  const rules = [
    { type: 'text', ruleName: 'Text Rule', searchValue: 'test', searchType: 'Contains', containing: 'containing' },
    { type: 'page-title', ruleName: 'Page Title Rule', searchValue: 'test', searchType: 'Contains', containing: 'containing' },
    { type: 'page-title-length', ruleName: 'Title Length Rule', comparison: 'Greater than', value: 10 },
    { type: 'page-url', ruleName: 'Page URL Rule', searchValue: 'test', searchType: 'Contains', containing: 'containing' },
    { type: 'link', ruleName: 'Link Rule', searchValue: 'test', searchType: 'Contains', containing: 'containing' },
    { type: 'link-text', ruleName: 'Link Text Rule', searchValue: 'test', searchType: 'Contains', containing: 'containing' },
    { type: 'link-text-length', ruleName: 'Link Text Length Rule', comparison: 'Greater than', value: 5 },
    { type: 'file-size', ruleName: 'File Size Rule', comparison: 'Greater than', value: 10, unit: 'KB' },
    { type: 'image-size', ruleName: 'Image Size Rule', comparison: 'Greater than', value: 10, unit: 'KB' },
    { type: 'image-text', ruleName: 'Image Text Rule', searchValue: 'test', searchType: 'Contains', containing: 'containing' },
    { type: 'image-text-length', ruleName: 'Image Text Length Rule', comparison: 'Greater than', value: 5 },
    { type: 'external-link-count', ruleName: 'External Link Count Rule', comparison: 'Greater than', value: 1 },
    { type: 'incoming-link-count', ruleName: 'Incoming Link Count Rule', comparison: 'Greater than', value: 1 },
    { type: 'heading-text', ruleName: 'Heading Text Rule', searchValue: 'test', searchType: 'Contains', containing: 'containing' },
    { type: 'header-text-length', ruleName: 'Heading Text Length Rule', comparison: 'Greater than', value: 5 },
    { type: 'readability-level', ruleName: 'Readability Level Rule', comparison: 'Greater than', value: 5 },
    { type: 'meta-header', ruleName: 'Meta Header Rule', searchValue: 'test', searchType: 'Contains', containing: 'containing' },
    { type: 'meta-header-length', ruleName: 'Meta Header Length Rule', comparison: 'Greater than', value: 5 },
    { type: 'page-html', ruleName: 'Page HTML Rule', searchValue: 'test', searchType: 'Contains', containing: 'containing' }
  ];

  // Assign generated IDs to all rules
  rules.forEach((r, i) => r.id = Date.now() + i);

  const Policy = conn.model('Policy', new mongoose.Schema({}, { strict: false, collection: 'policies' }));
  const policies = await Policy.find({ title: /Sample Policy/ });
  
  let count = 0;
  for (const p of policies) {
    await Policy.updateOne({ _id: p._id }, { $set: { rules: rules } });
    count++;
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
