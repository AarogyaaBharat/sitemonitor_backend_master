const mongoose = require('mongoose');
const DB_URL_BASE = 'mongodb+srv://sitemonitor26_db_user:lbbxaH2mDEHLyitL@cluster0.ev4p3qf.mongodb.net/';
const OPTS = '?retryWrites=true&w=majority';

async function fixDb(dbName) {
  const url = DB_URL_BASE + dbName + OPTS;
  const conn = await mongoose.createConnection(url).asPromise();
  
  const rules = [
    { type: 'text', ruleName: 'Find Jewellery Keywords', searchValue: 'jewellery', searchType: 'Contains', containing: 'containing' },
    { type: 'page-title', ruleName: 'Title contains Jewellery', searchValue: 'jewellery', searchType: 'Contains', containing: 'containing' },
    { type: 'page-title-length', ruleName: 'Title Length > 60 chars', comparison: 'Greater than', value: 60 },
    { type: 'page-url', ruleName: 'URL contains shop', searchValue: 'shop', searchType: 'Contains', containing: 'containing' },
    { type: 'link', ruleName: 'Link contains contact', searchValue: 'contact', searchType: 'Contains', containing: 'containing' },
    { type: 'link-text', ruleName: 'Link text contains buy', searchValue: 'buy', searchType: 'Contains', containing: 'containing' },
    { type: 'link-text-length', ruleName: 'Link text > 50 chars', comparison: 'Greater than', value: 50 },
    { type: 'file-size', ruleName: 'File > 5MB', comparison: 'Greater than', value: 5, unit: 'MB' },
    { type: 'image-size', ruleName: 'Images greater than 100kB', comparison: 'Greater than', value: 100, unit: 'KB' },
    { type: 'image-text', ruleName: 'Image alt contains logo', searchValue: 'logo', searchType: 'Contains', containing: 'containing' },
    { type: 'image-text-length', ruleName: 'Image alt > 100 chars', comparison: 'Greater than', value: 100 },
    { type: 'external-link-count', ruleName: 'External links > 10', comparison: 'Greater than', value: 10 },
    { type: 'incoming-link-count', ruleName: 'Incoming links > 5', comparison: 'Greater than', value: 5 },
    { type: 'heading-text', ruleName: 'Heading contains price', searchValue: 'price', searchType: 'Contains', containing: 'containing' },
    { type: 'header-text-length', ruleName: 'Heading > 80 chars', comparison: 'Greater than', value: 80 },
    { type: 'readability-level', ruleName: 'Readability > 12', comparison: 'Greater than', value: 12 },
    { type: 'meta-header', ruleName: 'Meta contains keyword', searchValue: 'keyword', searchType: 'Contains', containing: 'containing' },
    { type: 'meta-header-length', ruleName: 'Meta length > 160 chars', comparison: 'Greater than', value: 160 },
    { type: 'page-html', ruleName: 'HTML contains script', searchValue: '<script>', searchType: 'Contains', containing: 'containing' }
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
