import puppeteer from 'puppeteer';
import { AxePuppeteer } from '@axe-core/puppeteer';
import { AccessibilityReportSchema } from '../models/AccessibilityReport.js';
import { AccessibilitySummarySchema } from '../models/AccessibilitySummary.js';
import { logger } from '../utils/logger.js';

function normalizeHost(domainName) {
  return String(domainName || '')
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[/\\]+.*$/, '');
}

/**
 * Run Axe-core on a single URL using Puppeteer.
 */
async function analyzeUrlWithAxe(browser, url) {
  let page;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Inject and run axe-core
    const results = await new AxePuppeteer(page).analyze();
    
    // Calculate a rough score out of 100
    const totalChecks = results.passes.length + results.violations.length + results.incomplete.length;
    let score = 100;
    if (totalChecks > 0) {
      const deduction = results.violations.reduce((acc, v) => {
        if (v.impact === 'critical') return acc + 10;
        if (v.impact === 'serious') return acc + 5;
        if (v.impact === 'moderate') return acc + 2;
        return acc + 1; // minor
      }, 0);
      score = Math.max(0, 100 - deduction);
    }

    return {
      success: true,
      url,
      score,
      passedCount: results.passes.length,
      failedCount: results.violations.length,
      warningCount: results.incomplete.length,
      notApplicableCount: results.inapplicable.length,
      issues: results.violations.map(v => ({
        id: v.id,
        impact: v.impact || 'moderate',
        description: v.description,
        help: v.help,
        helpUrl: v.helpUrl,
        tags: v.tags || [],
        nodes: v.nodes.map(n => ({
          html: n.html,
          failureSummary: n.failureSummary
        }))
      })),
      passes: results.passes.map(p => ({
        id: p.id,
        description: p.description,
        help: p.help,
        helpUrl: p.helpUrl,
        tags: p.tags || [],
        nodes: p.nodes.map(n => ({ html: n.html }))
      })),
      incompleteChecks: results.incomplete.map(i => ({
        id: i.id,
        description: i.description,
        help: i.help,
        helpUrl: i.helpUrl,
        tags: i.tags || []
      })),
      notApplicableChecks: results.inapplicable.map(na => ({
        id: na.id,
        description: na.description,
        help: na.help,
        helpUrl: na.helpUrl,
        tags: na.tags || []
      }))
    };
  } catch (error) {
    logger.error(`Axe-core failed for ${url}: ${error.message}`);
    return { success: false, url, error: error.message };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

/**
 * Runs accessibility scan on an array of URLs and saves to DB.
 */
export async function runAccessibilityScan(domainName, reports, scanJobId, conn, options = {}) {
  const host = normalizeHost(domainName);
  const scanDate = new Date();
  
  // Extract unique URLs from reports
  const urlsToScan = [...new Set(reports.map(r => r.url))].filter(Boolean);
  
  logger.info(`♿ [${host}] Starting Accessibility scan for ${urlsToScan.length} pages...`);
  
  let browser;
  const pageReports = [];
  
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      ignoreHTTPSErrors: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    // Process in batches of 5 to avoid overwhelming the system
    const batchSize = 5;
    for (let i = 0; i < urlsToScan.length; i += batchSize) {
      const batchUrls = urlsToScan.slice(i, i + batchSize);
      const batchPromises = batchUrls.map(url => analyzeUrlWithAxe(browser, url));
      const batchResults = await Promise.all(batchPromises);
      
      for (const res of batchResults) {
        if (res.success) {
          const originalReport = reports.find(r => r.url === res.url);
          pageReports.push({
            domain: host,
            url: res.url,
            title: originalReport?.meta?.title || originalReport?.title || res.url,
            jobId: scanJobId,
            scanDate,
            score: res.score,
            passedCount: res.passedCount,
            failedCount: res.failedCount,
            warningCount: res.warningCount,
            notApplicableCount: res.notApplicableCount,
            issues: res.issues,
            passes: res.passes,
            incompleteChecks: res.incompleteChecks || [],
            notApplicableChecks: res.notApplicableChecks || []
          });
        }
      }
      logger.info(`♿ [${host}] Axe-core scanned ${Math.min(i + batchSize, urlsToScan.length)}/${urlsToScan.length}`);
    }
  } finally {
    if (browser) await browser.close();
  }

  // Calculate Summary
  let averageScore = 0;
  let totalPassedChecks = 0;
  let totalFailedChecks = 0;
  let totalWarnings = 0;
  let criticalIssuesCount = 0;
  let seriousIssuesCount = 0;
  let moderateIssuesCount = 0;
  let minorIssuesCount = 0;
  let pagesWithIssues = 0;
  
  const issueAgg = new Map();
  const snippetAgg = new Map();
  let totalViolations = 0;

  pageReports.forEach(report => {
    averageScore += report.score;
    totalPassedChecks += report.passedCount;
    totalFailedChecks += report.failedCount;
    totalWarnings += report.warningCount;
    
    if (report.failedCount > 0) pagesWithIssues++;

    report.issues.forEach(issue => {
      totalViolations++;
      if (issue.impact === 'critical') criticalIssuesCount++;
      else if (issue.impact === 'serious') seriousIssuesCount++;
      else if (issue.impact === 'moderate') moderateIssuesCount++;
      else minorIssuesCount++;

      const key = issue.id;
      if (!issueAgg.has(key)) {
        issueAgg.set(key, {
          id: issue.id,
          impact: issue.impact,
          description: issue.description,
          help: issue.help,
          tags: issue.tags || [],
          failedPages: new Set(),
          passedPages: new Set()
        });
      }
      issueAgg.get(key).failedPages.add(report.url);

      // Aggregate HTML snippets
      if (issue.nodes) {
        issue.nodes.forEach(node => {
          const htmlStr = (node.html || '').trim();
          if (!htmlStr) return;
          
          if (!snippetAgg.has(htmlStr)) {
            snippetAgg.set(htmlStr, {
              html: htmlStr,
              affectedPages: new Set(),
              checks: new Set(),
              count: 0
            });
          }
          const s = snippetAgg.get(htmlStr);
          s.affectedPages.add(report.url);
          s.checks.add(issue.id);
          s.count++;
        });
      }
    });

    report.passes.forEach(pass => {
      const key = pass.id;
      if (!issueAgg.has(key)) {
        issueAgg.set(key, {
          id: pass.id,
          impact: 'none',
          description: pass.description,
          help: pass.help,
          tags: pass.tags || [],
          failedPages: new Set(),
          passedPages: new Set()
        });
      }
      issueAgg.get(key).passedPages.add(report.url);
    });

    (report.notApplicableChecks || []).forEach(na => {
      const key = na.id;
      if (!issueAgg.has(key)) {
        issueAgg.set(key, {
          id: na.id,
          impact: 'none',
          description: na.description,
          help: na.help,
          tags: na.tags || [],
          failedPages: new Set(),
          passedPages: new Set()
        });
      }
      issueAgg.get(key).passedPages.add(report.url);
    });

    (report.incompleteChecks || []).forEach(inc => {
      const key = inc.id;
      if (!issueAgg.has(key)) {
        issueAgg.set(key, {
          id: inc.id,
          impact: 'none',
          description: inc.description,
          help: inc.help,
          tags: inc.tags || [],
          failedPages: new Set(),
          passedPages: new Set()
        });
      }
      issueAgg.get(key).passedPages.add(report.url);
    });
  });

  if (pageReports.length > 0) {
    averageScore = Math.round(averageScore / pageReports.length);
  }

  const allChecks = [...issueAgg.values()].map(agg => {
    const isFailed = agg.failedPages.size > 0;
    return {
      id: agg.id,
      impact: isFailed ? agg.impact : 'none',
      description: agg.description,
      help: agg.help,
      tags: agg.tags,
      passed: !isFailed,
      count: isFailed ? agg.failedPages.size : agg.passedPages.size
    };
  });
  const mostCommonIssues = allChecks
    .filter(c => !c.passed)
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  let snippetIdCounter = 1;
  const topSnippets = [...snippetAgg.values()]
    .map(s => {
      const effectPercent = totalViolations > 0 ? ((s.count / totalViolations) * 100).toFixed(2) : 0;
      return {
        id: String(snippetIdCounter++),
        html: s.html,
        pagesCount: s.affectedPages.size,
        checks: Array.from(s.checks),
        effectPercent: parseFloat(effectPercent)
      };
    })
    .sort((a, b) => b.effectPercent - a.effectPercent)
    .slice(0, 100); // Store up to 100 top snippets

  const summary = {
    domain: host,
    jobId: scanJobId,
    scanDate,
    totalPagesScanned: pageReports.length,
    averageScore,
    totalPassedChecks,
    totalFailedChecks,
    totalWarnings,
    criticalIssuesCount,
    seriousIssuesCount,
    moderateIssuesCount,
    minorIssuesCount,
    pagesWithIssues,
    mostCommonIssues,
    allChecks,
    topSnippets
  };

  try {
    const ReportModel = conn.models.AccessibilityReport || conn.model('AccessibilityReport', AccessibilityReportSchema);
    const SummaryModel = conn.models.AccessibilitySummary || conn.model('AccessibilitySummary', AccessibilitySummarySchema);

    // Clean up old reports for this job (if any)
    await ReportModel.deleteMany({ domain: host, jobId: scanJobId });
    
    if (pageReports.length > 0) {
      await ReportModel.insertMany(pageReports);
    }
    await SummaryModel.create(summary);
    
    logger.info(`✅ [${host}] Accessibility scan saved: ${pageReports.length} pages, jobId ${scanJobId}`);
  } catch (err) {
    logger.error(`Accessibility persistence error for ${host}: ${err.message}`);
    throw err;
  }

  return { pageReports, summary };
}
