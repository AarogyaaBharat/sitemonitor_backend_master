const mongoose = require('mongoose');
const DB_URL_BASE = 'mongodb+srv://sitemonitor26_db_user:lbbxaH2mDEHLyitL@cluster0.ev4p3qf.mongodb.net/';
const OPTS = '?retryWrites=true&w=majority';

const singleRules = [
  { type: 'text', searchType: 'Contains', searchValue: 'jewellery', containing: 'containing' },
  { type: 'page-title', searchType: 'Contains', searchValue: 'jewellery', containing: 'containing' },
  { type: 'page-title-length', searchType: 'Greater than', searchValue: '60', containing: '' },
  { type: 'page-url', searchType: 'Contains', searchValue: 'shop', containing: 'containing' },
  { type: 'link', searchType: 'Contains', searchValue: 'contact', containing: 'containing' },
  { type: 'link-text', searchType: 'Contains', searchValue: 'buy', containing: 'containing' },
  { type: 'link-text-length', searchType: 'Greater than', searchValue: '50', containing: '' },
  { type: 'file-size', searchType: 'Greater than', searchValue: '5', containing: 'MB' },
  { type: 'image-size', searchType: 'Greater than', searchValue: '100', containing: 'KB' },
  { type: 'image-text', searchType: 'Contains', searchValue: 'logo', containing: 'containing' },
  { type: 'image-text-length', searchType: 'Greater than', searchValue: '100', containing: '' },
  { type: 'external-link-count', searchType: 'Greater than', searchValue: '10', containing: '' },
  { type: 'incoming-link-count', searchType: 'Greater than', searchValue: '5', containing: '' },
  { type: 'heading-text', searchType: 'Contains', searchValue: 'price', containing: 'containing' },
  { type: 'header-text-length', searchType: 'Greater than', searchValue: '80', containing: '' },
  { type: 'readability-level', searchType: 'Greater than', searchValue: '12', containing: '' },
  { type: 'meta-header', searchType: 'Contains', searchValue: 'keyword', containing: 'containing' },
  { type: 'meta-header-length', searchType: 'Greater than', searchValue: '160', containing: '' },
  { type: 'page-html', searchType: 'Contains', searchValue: '<script>', containing: 'containing' }
];

async function addSingleRulePolicies(dbName) {
  const url = DB_URL_BASE + dbName + OPTS;
  const conn = await mongoose.createConnection(url).asPromise();
  
  const Policy = conn.model('Policy', new mongoose.Schema({}, { strict: false, collection: 'policies' }));
  
  let count = 0;
  for (const rule of singleRules) {
    const policyTitle = `Test Policy: Single Rule (${rule.type})`;
    
    // Check if it already exists to prevent duplicates
    const existing = await Policy.findOne({ title: policyTitle });
    if (existing) {
      console.log(`Policy "${policyTitle}" already exists, skipping.`);
      continue;
    }

    const newPolicy = {
      title: policyTitle,
      description: `Testing the ${rule.type} rule individually`,
      category: 'required',
      priority: 'medium',
      status: 'active',
      isGlobal: true,
      domainIds: [],
      ruleOperator: 'or',
      rules: [
        {
          id: Date.now() + Math.floor(Math.random() * 1000),
          ruleName: `Rule 1 for ${rule.type}`,
          type: rule.type,
          searchType: rule.searchType,
          searchValue: rule.searchValue,
          containing: rule.containing,
          comparison: rule.searchType, // adding robust fields just in case
          value: rule.searchValue,
          unit: rule.containing
        }
      ],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await Policy.create(newPolicy);
    count++;
    console.log(`Created policy: ${policyTitle}`);
  }
  
  console.log(`Successfully added ${count} new single-rule policies to ${dbName}`);
  await conn.close();
}

async function run() {
  await addSingleRulePolicies('tenant_sbi');
  process.exit();
}

run().catch(console.error);
