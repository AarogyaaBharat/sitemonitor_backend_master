import { QaReportSchema } from '../models/QaReport.js';
import { QaSummarySchema } from '../models/QaSummary.js';
import { logger } from '../utils/logger.js';

function normalizeHost(domainName) {
  return String(domainName || '')
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[/\\]+.*$/, '');
}

function isInternalUrl(href, hostNorm) {
  try {
    const hn = new URL(href).hostname.replace(/^www\./, '').toLowerCase();
    return hn === hostNorm.replace(/^www\./, '');
  } catch {
    return false;
  }
}

function normalizeUrlKey(u) {
  return String(u || '')
    .trim()
    .replace(/\/$/, '')
    .toLowerCase();
}

/** Fetch <loc> URLs from sitemap.xml when available */
export async function fetchSitemapPageUrls(domainName) {
  const origin = /^https?:\/\//i.test(domainName)
    ? domainName.replace(/\/$/, '')
    : `https://${normalizeHost(domainName)}`;
  const urls = [];
  try {
    const axios = (await import('axios')).default;
    const res = await axios.get(`${origin}/sitemap.xml`, {
      timeout: 8000,
      validateStatus: () => true,
    });
    if (res.status === 200) {
      const text = String(res.data || '');
      const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
      let m;
      while ((m = re.exec(text)) !== null) {
        urls.push(m[1].trim());
      }
    }
  } catch {
    /* optional */
  }
  return urls;
}

/** Map grade-level score (0–20) to readable label buckets */
export function readabilityLabelFromGrade(grade) {
  const g = Number(grade) || 0;
  if (g <= 5) return '5th grade or below';
  if (g <= 6) return '6th grade';
  if (g <= 7) return '7th grade';
  if (g <= 8) return '8th grade';
  if (g <= 9) return '8th to 9th grade';
  if (g <= 10) return '9th grade';
  if (g <= 12) return '10th to 12th grade';
  if (g <= 14) return 'College';
  return 'College graduate';
}

function extractBrokenLinksFromReport(report, hostNorm, sitemapUrlKeys) {
  const brokenUrls = report.links?.brokenDetails || [];
  const linkDetails = report.links?.linkDetails || [];
  const detailByUrl = new Map();
  linkDetails.forEach((ld) => {
    if (ld?.url) detailByUrl.set(ld.url, ld);
  });

  const pageInSitemap = sitemapUrlKeys?.has(normalizeUrlKey(report.url));

  return brokenUrls.map((href) => {
    const detail = detailByUrl.get(href) || {};
    const hrefInSitemap = sitemapUrlKeys?.has(normalizeUrlKey(href));
    return {
      href,
      statusCode: detail.statusCode || 404,
      type: (detail.internal ?? isInternalUrl(href, hostNorm)) ? 'internal' : 'external',
      anchorText: detail.anchorText || '',
      contextSnippet: detail.anchorText || '',
      isFixed: false,
      isIgnored: false,
      inSitemap: !!(pageInSitemap || hrefInSitemap),
    };
  });
}

function extractBrokenImagesFromReport(report) {
  const images = report.imageAnalysis?.imageLoadDetails || report.images?.imageLoadDetails || [];
  const broken = [];
  for (const img of images) {
    if (!img.url) continue;
    const status = img.statusCode ?? img.status ?? img.httpStatus;
    if (status == null || status < 400) continue;
    broken.push({
      src: img.url,
      altText: img.alt || '',
      size: img.size || 'Unknown',
      statusCode: status,
      isFixed: false,
      isIgnored: false,
    });
  }
  return broken;
}

function extractMisspellingsFromReport(report, ignoredSet) {
  const corrections = report.textMetrics?.spellingCorrections || [];
  return corrections
    .filter((c) => c.word && !ignoredSet.has(String(c.word).toLowerCase()))
    .map((c) => ({
      word: c.word,
      suggestions: c.suggestions || [],
      contextSnippet: (c.suggestions || []).slice(0, 3).join(', '),
      isPotential: false,
    }));
}

function extractPotentialMisspellingsFromReport(report, ignoredSet) {
  const keywords = report.textMetrics?.spellingMistakesKeywords || [];
  const confirmed = new Set(
    (report.textMetrics?.spellingCorrections || []).map((c) => String(c.word).toLowerCase())
  );

  const potential = [];
  const seen = new Set();

  keywords.forEach((word) => {
    const w = String(word || '').trim();
    const wl = w.toLowerCase();
    if (!w || wl.length < 2 || wl.length > 64 || ignoredSet.has(wl) || seen.has(wl)) return;
    if (confirmed.has(wl)) return;
    seen.add(wl);
    potential.push({
      word: w,
      suggestions: [],
      contextSnippet: '',
      isPotential: true,
    });
  });

  return potential;
}

/**
 * Transform SEO crawl reports into per-page QA documents and domain summary.
 */
export async function runQaScan(domainName, reports, jobId, conn, options = {}) {
  const host = normalizeHost(domainName);
  const hostNorm = host.replace(/^www\./, '');
  const ignoredSpellings = new Set((options.ignoredSpellings || []).map((s) => String(s).toLowerCase()));
  const sitemapUrls = new Set(
    (options.sitemapUrls || []).map((u) => normalizeUrlKey(u))
  );

  const brokenLinkAgg = new Map();
  const brokenImageAgg = new Map();
  const misspellingAgg = new Map();
  const potentialAgg = new Map();
  const readabilityBuckets = new Map();
  const statusCodeCounts = new Map();

  let totalBrokenLinks = 0;
  let totalBrokenImages = 0;
  let totalMisspellings = 0;
  let totalPotentialMisspellings = 0;
  let internalBrokenLinks = 0;
  let externalBrokenLinks = 0;
  let brokenLinksFixed = 0;
  let brokenLinksIgnored = 0;
  let brokenLinksInSitemap = 0;
  let pagesWithMisspellings = 0;
  let pagesWithPotentialMisspellings = 0;
  let pagesWithBrokenLinks = 0;
  let pagesWithBrokenImages = 0;
  let pagesWithQaErrors = 0;
  const scanDate = new Date();

  const pageReports = reports.map((report) => {
    const brokenLinks = extractBrokenLinksFromReport(report, hostNorm, sitemapUrls);
    const brokenImages = extractBrokenImagesFromReport(report);
    const misspellings = extractMisspellingsFromReport(report, ignoredSpellings);
    const potentialMisspellings = extractPotentialMisspellingsFromReport(report, ignoredSpellings);
    const readabilityScore = report.textMetrics?.readabilityScore ?? 0;
    const readabilityLevel = readabilityLabelFromGrade(readabilityScore);

    totalBrokenLinks += brokenLinks.length;
    totalBrokenImages += brokenImages.length;
    totalMisspellings += misspellings.length;
    totalPotentialMisspellings += potentialMisspellings.length;

    if (misspellings.length > 0) pagesWithMisspellings++;
    if (potentialMisspellings.length > 0) pagesWithPotentialMisspellings++;
    if (brokenLinks.length > 0) pagesWithBrokenLinks++;
    if (brokenImages.length > 0) pagesWithBrokenImages++;
    if (
      brokenLinks.length > 0 ||
      brokenImages.length > 0 ||
      misspellings.length > 0 ||
      potentialMisspellings.length > 0
    ) {
      pagesWithQaErrors++;
    }

    readabilityBuckets.set(readabilityLevel, (readabilityBuckets.get(readabilityLevel) || 0) + 1);

    brokenLinks.forEach((bl) => {
      const key = bl.href;
      const code = bl.statusCode || 404;
      statusCodeCounts.set(code, (statusCodeCounts.get(code) || 0) + 1);
      if (bl.type === 'internal') internalBrokenLinks++;
      else externalBrokenLinks++;

      if (bl.inSitemap) brokenLinksInSitemap++;

      if (!brokenLinkAgg.has(key)) {
        brokenLinkAgg.set(key, {
          href: key,
          statusCode: code,
          type: bl.type,
          pages: new Set(),
          documents: new Set(),
          isFixed: false,
          isIgnored: false,
          inSitemap: !!bl.inSitemap,
        });
      }
      const agg = brokenLinkAgg.get(key);
      if (bl.inSitemap) agg.inSitemap = true;
      agg.pages.add(report.url);
      if (bl.isFixed) {
        agg.isFixed = true;
        brokenLinksFixed++;
      }
      if (bl.isIgnored) {
        agg.isIgnored = true;
        brokenLinksIgnored++;
      }
    });

    brokenImages.forEach((bi) => {
      if (!brokenImageAgg.has(bi.src)) {
        brokenImageAgg.set(bi.src, { src: bi.src, pages: new Set() });
      }
      brokenImageAgg.get(bi.src).pages.add(report.url);
    });

    misspellings.forEach((m) => {
      const mk = m.word.toLowerCase();
      if (!misspellingAgg.has(mk)) {
        misspellingAgg.set(mk, { word: m.word, pages: new Set(), count: 0 });
      }
      const ma = misspellingAgg.get(mk);
      ma.pages.add(report.url);
      ma.count++;
    });

    potentialMisspellings.forEach((m) => {
      const pk = String(m.word).toLowerCase();
      if (!potentialAgg.has(pk)) {
        potentialAgg.set(pk, { word: m.word, pages: new Set(), count: 0 });
      }
      const pa = potentialAgg.get(pk);
      pa.pages.add(report.url);
      pa.count++;
    });

    const title = report.meta?.title || report.url;

    return {
      domain: host,
      url: report.url,
      title,
      scanDate,
      jobId,
      readabilityScore,
      readabilityLevel,
      httpStatus: report.httpStatus || 200,
      brokenLinks,
      brokenImages,
      misspellings,
      potentialMisspellings,
      issueCount:
        brokenLinks.length + brokenImages.length + misspellings.length + potentialMisspellings.length,
      hasQaErrors:
        brokenLinks.length > 0 ||
        brokenImages.length > 0 ||
        misspellings.length > 0 ||
        potentialMisspellings.length > 0,
    };
  });

  let brokenLinksAffectingMostContent = null;
  let maxBlPages = 0;
  brokenLinkAgg.forEach((v) => {
    if (v.pages.size > maxBlPages) {
      maxBlPages = v.pages.size;
      brokenLinksAffectingMostContent = v.href;
    }
  });

  let brokenImagesAffectingMostContent = null;
  let maxBiPages = 0;
  brokenImageAgg.forEach((v) => {
    if (v.pages.size > maxBiPages) {
      maxBiPages = v.pages.size;
      brokenImagesAffectingMostContent = v.src;
    }
  });

  let misspellingAffectingMostContent = null;
  let maxMissPages = 0;
  misspellingAgg.forEach((v) => {
    if (v.pages.size > maxMissPages) {
      maxMissPages = v.pages.size;
      misspellingAffectingMostContent = v.word;
    }
  });

  let mostCommonReadabilityLevel = null;
  let maxReadCount = 0;
  readabilityBuckets.forEach((count, level) => {
    if (count > maxReadCount) {
      maxReadCount = count;
      mostCommonReadabilityLevel = level;
    }
  });

  const compliantPages = reports.length - pagesWithQaErrors;
  const qaCompliancePercent =
    reports.length > 0 ? Math.round((compliantPages / reports.length) * 10000) / 100 : 100;

  const summary = {
    domain: host,
    scanDate,
    jobId,
    totalPagesScanned: reports.length,
    totalBrokenLinks,
    uniqueBrokenLinks: brokenLinkAgg.size,
    brokenLinkStatusCodes: Object.fromEntries(statusCodeCounts),
    internalBrokenLinks,
    externalBrokenLinks,
    brokenLinksAffectingMostContent,
    brokenLinksInSitemap,
    brokenLinksFixed,
    brokenLinksIgnored,
    totalBrokenImages,
    uniqueBrokenImages: brokenImageAgg.size,
    brokenImagesAffectingMostContent,
    pagesWithMisspellings,
    uniqueMisspellings: misspellingAgg.size,
    totalMisspellings,
    uniquePotentialMisspellings: potentialAgg.size,
    totalPotentialMisspellings,
    pagesWithPotentialMisspellings,
    pagesWithBrokenLinks,
    pagesWithBrokenImages,
    pagesWithQaErrors,
    contentWithQaErrors: pagesWithQaErrors,
    misspellingAffectingMostContent,
    mostCommonReadabilityLevel,
    readabilityDistribution: Object.fromEntries(readabilityBuckets),
    readabilityPagesCount: maxReadCount,
    qaCompliancePercent,
    totalQaIssues:
      totalBrokenLinks + totalBrokenImages + totalMisspellings + totalPotentialMisspellings,
    topMisspellings: [...misspellingAgg.values()]
      .sort((a, b) => b.pages.size - a.pages.size)
      .slice(0, 10)
      .map((m) => ({ word: m.word, pagesCount: m.pages.size })),
    topPotentialMisspellings: [...potentialAgg.values()]
      .sort((a, b) => b.pages.size - a.pages.size)
      .slice(0, 10)
      .map((m) => ({ word: m.word, pagesCount: m.pages.size })),
  };

  try {
    const QaReportModel = conn.models.QaReport || conn.model('QaReport', QaReportSchema);
    const QaSummaryModel = conn.models.QaSummary || conn.model('QaSummary', QaSummarySchema);

    await QaReportModel.deleteMany({ domain: host, jobId });
    if (pageReports.length > 0) {
      await QaReportModel.insertMany(pageReports);
    }
    await QaSummaryModel.create(summary);
    logger.info(`📋 [${host}] QA scan saved: ${pageReports.length} pages, jobId ${jobId}`);
  } catch (err) {
    logger.error(`QA persistence error for ${host}: ${err.message}`);
    throw err;
  }

  return { pageReports, summary, brokenLinkAgg, brokenImageAgg };
}
