import mongoose from 'mongoose';
import { DomainSchema } from '../src/models/Domain.js';
import { DomainSummarySchema } from '../src/models/DomainSummary.js';
import { DomainReportSchema } from '../src/models/DomainReport.js';

const DB_URL = "mongodb+srv://sitemonitor26_db_user:lbbxaH2mDEHLyitL@cluster0.ev4p3qf.mongodb.net/?appName=Cluster0";
const CLIENT_DB = "tenant_sbi";
const DOMAIN = "omunim.com";

// Paste the normalization and query logic from get_domain_seo_pages_service
async function testIssue(issue) {
  try {
    const conn = await mongoose.createConnection(DB_URL, { dbName: CLIENT_DB }).asPromise();
    
    const Domain = conn.model('Domain', DomainSchema, 'domains');
    const DomainSummary = conn.model('DomainSummary', DomainSummarySchema, 'domain_summaries');
    const DomainReport = conn.model('DomainReport', DomainReportSchema, 'domain_reports');
    
    const domainDoc = await Domain.findOne({ dm_url: new RegExp(DOMAIN, 'i'), dm_is_deleted: false });
    if (!domainDoc) {
      console.log("Domain not found!");
      await conn.close();
      return;
    }
    
    const host = domainDoc.dm_url.toLowerCase().trim().replace(/^https?[:/\\]+/i, '').replace(/[/\\]+.*$/, '');
    const latestSummary = await DomainSummary.findOne({ domain: host }).sort({ lastScanDate: -1 });
    
    const filter = { domain: host };
    if (latestSummary && latestSummary.jobId) {
      filter.jobId = latestSummary.jobId;
    }
    
    console.log(`\n--- Testing Issue: "${issue}" ---`);
    console.log("Using jobId filter:", filter.jobId);
    
    if (issue) {
      const checkIssue = issue.toLowerCase().trim();
      const lowerIssue = issue.toLowerCase();
      const normalize = s => (s || "").toLowerCase()
        .replace(/^fix\s+/i, '')
        .replace(/^review\s+/i, '')
        .replace(/\(\d+(\.\d+)?s?\)/g, '(...)')
        .replace(/\d+\s+key\s+legal\s+terms/i, 'key legal terms')
        .replace(/\d+\s+image\(s\)/i, 'images')
        .replace(/\d+\s+spelling\s+issues/i, 'spelling issues')
        .replace(/\d+\s+broken\s+links/i, 'broken links')
        .replace(/\d+\s+large\s+images/i, 'large images')
        .replace(/>\d+KB/i, '>KB')
        .replace(/\.$/, '')
        .replace(/s\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const normalizedIssue = normalize(lowerIssue);
      const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      let issueFilters = [
        { 'seoImprovements.message': issue },
        { 'seoImprovements.message': { $regex: escapeRegex(normalizedIssue), $options: 'i' } }
      ];
      
      // Category fallback regexes
      if (normalizedIssue.includes('spelling') || normalizedIssue.includes('misspell') || normalizedIssue.includes('typo')) {
        issueFilters.push({ 'seoImprovements.type': 'spelling' });
        issueFilters.push({ 'misspellings.0': { $exists: true } });
      } else if (normalizedIssue.includes('broken link') || normalizedIssue.includes('404')) {
        issueFilters.push({ 'brokenLinks.0': { $exists: true } });
        issueFilters.push({ 'seoImprovements.type': 'broken-links' });
      } else if (normalizedIssue.includes('h1 missing') || normalizedIssue.includes('h1 tag missing') || normalizedIssue.includes('missing h1')) {
        issueFilters.push({ 'headings.h1': 0 });
        issueFilters.push({ 'seoImprovements.message': { $regex: /missing.*h1|h1.*missing/i } });
      } else if (normalizedIssue.includes('lcp') || normalizedIssue.includes('largest contentful paint')) {
        issueFilters.push({ 'seoImprovements.message': { $regex: /lcp/i } });
      } else if (normalizedIssue.includes('t&c') || normalizedIssue.includes('terms') || normalizedIssue.includes('compliance')) {
        issueFilters.push({ 'seoImprovements.message': { $regex: /terms|t&c|compliance/i } });
      }
      
      filter.$or = issueFilters;
    }
    
    const allReports = await DomainReport.find(filter).sort({ scanDate: -1 });
    console.log(`Matched reports in DB: ${allReports.length}`);
    
    const uniqueReportsMap = new Map();
    for (const r of allReports) {
      if (r.url && !uniqueReportsMap.has(r.url)) {
        uniqueReportsMap.set(r.url, r);
      }
    }
    const uniqueReports = Array.from(uniqueReportsMap.values());
    console.log(`De-duplicated unique reports: ${uniqueReports.length}`);
    
    // Map targetedIssueCount
    const mapped = uniqueReports.map(r => {
      const lowerIssue = issue.toLowerCase();
      const normalize = s => (s || "").toLowerCase()
        .replace(/^fix\s+/i, '')
        .replace(/^review\s+/i, '')
        .replace(/\(\d+(\.\d+)?s?\)/g, '(...)')
        .replace(/\d+\s+key\s+legal\s+terms/i, 'key legal terms')
        .replace(/\d+\s+image\(s\)/i, 'images')
        .replace(/\d+\s+spelling\s+issues/i, 'spelling issues')
        .replace(/\d+\s+broken\s+links/i, 'broken links')
        .replace(/\d+\s+large\s+images/i, 'large images')
        .replace(/>\d+KB/i, '>KB')
        .replace(/\.$/, '')
        .replace(/s\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      const normalizedIssue = normalize(lowerIssue);
      
      let target = (r.seoImprovements || []).find(imp => {
        const m = (imp.message || "").toLowerCase();
        const nm = normalize(m);
        return m === lowerIssue || nm === normalizedIssue || m.includes(normalizedIssue) || lowerIssue.includes(nm);
      });
      
      let count = target ? (target.count || 0) : 0;
      
      // Spelling, broken link, broken image fallbacks
      if (count <= 1) {
        if (normalizedIssue.includes('spelling')) {
          count = (r.misspellings || r.textMetrics?.misspellings || r.spelling_mistakes || []).length || count;
        } else if (normalizedIssue.includes('broken link')) {
          count = (r.brokenLinks || r.broken_links || (r.links && r.links.broken) || []).length || count;
        }
      }
      
      return {
        url: r.url,
        targetedIssueCount: count || 1,
        seoImprovementsCount: (r.seoImprovements || []).length
      };
    });
    
    const filtered = mapped.filter(p => p.targetedIssueCount > 0);
    console.log(`Filtered pages (targetedIssueCount > 0): ${filtered.length}`);
    for (const p of filtered) {
      console.log(`  - Page: ${p.url}, targetedIssueCount: ${p.targetedIssueCount}`);
    }
    
    await conn.close();
  } catch (err) {
    console.error("Test failed:", err);
  }
}

async function runAll() {
  await testIssue("Critical: Missing H1 heading.");
  await testIssue("Fix 2 broken links.");
  await testIssue("LCP is slow (4.91s).");
  await testIssue("Terms & Conditions is missing key legal clauses.");
}

runAll();
