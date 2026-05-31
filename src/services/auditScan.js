import { AuditSchema } from '../models/Audit.js';
import { logger } from '../utils/logger.js';

/**
 * Compiles and persists scan results to the Audit database collection.
 * Stores both overall domain summaries and individual page-level metrics.
 * 
 * @param {Array} reports - The list of page crawler reports.
 * @param {Object} summaryDoc - The overall domain summary document calculated by the processor.
 * @param {string} domainName - The crawled domain name.
 * @param {string} jobId - The scan's job ID.
 * @param {Object} conn - The client database connection.
 */
export const runAuditScan = async (reports, summaryDoc, domainName, jobId, conn) => {
  const host = domainName.toLowerCase().trim().replace(/^https?[:/\\]+/i, '').replace(/[/\\]+.*$/, '');
  
  logger.info(`📋 [${host}] Compiling detailed audit data snapshot for jobId: ${jobId}...`);
  
  try {
    const AuditModel = conn.model('Audit', AuditSchema);
    
    // 1. Performance Summary
    const avgPerformanceScore = summaryDoc.performanceMetrics?.avgPerformanceScore ?? 0;
    const avgLCP = parseFloat(summaryDoc.performanceMetrics?.avgLCP || 0);
    
    // Average INP calculations
    const inpVals = reports.map(r => r.performance?.inp || r.performance?.interactionToNextPaint || 0).filter(v => v > 0);
    const avgINP = inpVals.length > 0 ? Math.round(inpVals.reduce((sum, v) => sum + v, 0) / inpVals.length) : 0;
    
    // 2. Scan Coverage / Page counts
    const totalPages = reports.length;
    const statusCounts = { 200: 0, 301: 0, 302: 0, 404: 0, 500: 0, other: 0 };
    reports.forEach(r => {
      const s = r.httpStatus;
      if (s === 200) statusCounts[200]++;
      else if (s === 301) statusCounts[301]++;
      else if (s === 302) statusCounts[302]++;
      else if (s === 404) statusCounts[404]++;
      else if (s >= 500) statusCounts[500]++;
      else statusCounts.other++;
    });
    const validUrls = statusCounts[200] + statusCounts[301] + statusCounts[302];

    // 3. SEO Health Issues count
    const seoHealth = {
      'meta-title-missing': reports.filter(r => !r.meta?.title).length,
      'meta-description-missing': reports.filter(r => !r.meta?.description).length,
      'h1-tags-missing': reports.filter(r => (r.headings?.h1?.length || 0) === 0).length,
      'no-canonical': reports.filter(r => !r.meta?.canonical).length,
      'multiple-h1-tags': reports.filter(r => (r.headings?.h1?.length || 0) > 1).length,
      'meta-description-too-long': reports.filter(r => (r.meta?.description || '').length > 155).length,
      'meta-description-too-short': reports.filter(r => {
        const len = (r.meta?.description || '').length;
        return len > 0 && len < 30;
      }).length,
      'missing-alt-text': reports.reduce((sum, r) => sum + (r.images?.list || []).filter(img => !img.alt || img.alt.trim() === '').length, 0)
    };

    // 4. Spelling & Broken Links Summary
    const spellChecker = {
      totalMisspellings: 0,
      totalBrokenLinks: 0,
      pagesWithMisspellings: 0,
      pagesWithBrokenLinks: 0,
      'title-meta-spelling': 0,
      'headings-spelling': 0,
      'image-alt-spelling': 0,
      'anchor-cta-spelling': 0,
      'navigation-footer-spelling': 0,
      'form-labels-placeholders': 0,
      'language-consistency': 0,
      'accessibility-text-spelling': 0,
      'content-spelling': 0,
    };

    const scMapping = {
      'title-meta-spelling': [/title/i, /meta/i, /description/i],
      'headings-spelling': [/heading/i, /h1/i, /h2/i, /h3/i, /h4/i, /h5/i, /h6/i],
      'image-alt-spelling': [/image alt/i, /alt text/i],
      'anchor-cta-spelling': [/anchor/i, /cta/i, /link text/i],
      'navigation-footer-spelling': [/navigation/i, /footer/i, /nav/i],
      'form-labels-placeholders': [/form/i, /label/i, /placeholder/i],
      'language-consistency': [/language/i],
      'accessibility-text-spelling': [/accessibility/i, /aria/i],
    };

    const pagesWithMisspellingsSet = new Set();
    const pagesWithBrokenLinksSet = new Set();

    // Map and compile page-level details
    const pages = reports.map(r => {
      // Misspellings Count
      let misspellingsCount = (r.misspellings || r.textMetrics?.misspellings || r.spelling_mistakes || []).length;
      const spellingImps = (r.seoImprovements || []).filter(i => (i.type === 'spelling' || (i.message || "").toLowerCase().includes("spelling")));
      if (misspellingsCount === 0 && spellingImps.length > 0) {
        spellingImps.forEach(imp => {
          let count = imp.count || 0;
          if (count <= 1 && imp.message) {
            const match = imp.message.match(/(\d+)/);
            if (match) count = parseInt(match[1]);
          }
          if (count <= 1 && imp.details && Array.isArray(imp.details)) {
            count = imp.details.length || count;
          }
          misspellingsCount += (count || 1);
        });
      }

      if (misspellingsCount > 0) {
        spellChecker.totalMisspellings += misspellingsCount;
        pagesWithMisspellingsSet.add(r.url);
      }

      // Broken Links Count
      const bl = r.brokenLinks || r.broken_links || r.links?.brokenDetails || (Array.isArray(r.links?.broken) ? r.links.broken : []);
      const blCount = Array.isArray(bl) ? bl.length : (typeof r.links?.broken === 'number' ? r.links.broken : 0);
      let brokenLinksCount = blCount;
      if (blCount > 0 || (r.seoImprovements || []).some(i => i.type === 'broken-links')) {
        brokenLinksCount = blCount || 1;
        spellChecker.totalBrokenLinks += brokenLinksCount;
        pagesWithBrokenLinksSet.add(r.url);
      }

      // Categorize spellchecker message counts
      (r.seoImprovements || []).forEach(imp => {
        const msg = (imp.message || '').toLowerCase();
        if (msg.includes('spelling') || msg.includes('misspell') || msg.includes('typo')) {
          let count = imp.count || 0;
          if (count <= 1) {
            const match = msg.match(/(\d+)/);
            if (match) count = parseInt(match[1]);
          }
          if (count <= 1 && imp.details && Array.isArray(imp.details)) {
            count = imp.details.length || count;
          }
          count = count || 1;

          for (const [slug, regexes] of Object.entries(scMapping)) {
            if (regexes.some(rx => rx.test(msg))) {
              spellChecker[slug] += count;
            }
          }
        }
      });

      return {
        url: r.url,
        httpStatus: r.httpStatus || 200,
        seoScore: r.seoScore || 0,
        performanceScore: r.lighthousePerformanceScore || r.performance?.score || r.performance?.advancedMetrics?.performanceScore || 0,
        accessibilityScore: r.lighthouseAccessibilityScore || r.accessibility?.score || 0,
        lastCrawled: r.scanDate || r.scanCompletedAt || new Date(),
        
        hasTitle: !!r.meta?.title,
        hasDescription: !!r.meta?.description,
        h1Count: r.headings?.h1?.length || 0,
        hasCanonical: !!r.meta?.canonical,
        imagesWithoutAlt: (r.images?.list || []).filter(img => !img.alt || img.alt.trim() === '').length,
        
        misspellingsCount,
        brokenLinksCount
      };
    });

    spellChecker.pagesWithMisspellings = pagesWithMisspellingsSet.size;
    spellChecker.pagesWithBrokenLinks = pagesWithBrokenLinksSet.size;
    spellChecker['content-spelling'] = spellChecker.totalMisspellings;

    // 5. Final Audit Snap document assembly
    const auditDoc = {
      domain: host,
      jobId,
      scanDate: new Date(),
      performance: {
        score: avgPerformanceScore,
        avgLCP,
        avgINP,
        status: avgPerformanceScore >= 90 ? 'Good' : avgPerformanceScore >= 50 ? 'Needs Improvement' : 'Poor'
      },
      pagesAnalyzed: {
        totalPages,
        statusCodes: {
          200: statusCounts[200],
          301: statusCounts[301],
          302: statusCounts[302],
          404: statusCounts[404],
          500: statusCounts[500]
        },
        validUrls
      },
      seoHealth,
      responseStatus: {
        validUrls,
        200: statusCounts[200],
        301: statusCounts[301],
        302: statusCounts[302],
        404: statusCounts[404],
        500: statusCounts[500]
      },
      spellChecker,
      pages
    };

    // Save snapshot to Database table
    await AuditModel.create(auditDoc);
    logger.info(`💾 [${host}] Saved complete Audit details & summary snap to DB for jobId: ${jobId}`);
    
  } catch (error) {
    logger.error(`❌ [${host}] Failed compiling and saving Audit scan metrics: ${error.stack}`);
  }
};
