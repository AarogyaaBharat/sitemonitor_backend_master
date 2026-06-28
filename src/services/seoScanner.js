import puppeteer from 'puppeteer';
import axios from 'axios';
import * as cheerio from 'cheerio';
import tls from 'tls';
import { URL } from 'url';
import nspell from 'nspell';
import writeGood from 'write-good';
import dictionary from 'dictionary-en';
import { logger } from '../utils/logger.js';
import { performance } from 'perf_hooks';
import { COMPLIANCE_KEYWORDS } from '../config/complianceKeywords.js';

const STOP_WORDS = new Set(`a an the and or but in on at to for of as is was are were been be have has had do does did will would could should may might must can this that these those it its from with without by about into through during before after above below between under again further then once here there when where why how all each both few more most other some such no nor not only own same so than too very just don now`.split(/\s+/));
const TECH_ALLOWLIST = new Set(`npm api css html seo svg png jpg jpeg gif webp ico urls uri url http https ssl tls cdn dns tcp udp utc gmt json xml rss pdf btn ui ux faq ios sdk cli gui cpu gpu ram dns cname aaaa ipv ipv4 ipv6 www com net org io co uk us eu js ts jsx tsx git github gitlab npmjs node react vue angular webpack sass scss less php asp sql mysql postgres mongodb aws gcp azure oauth jwt rest graphql grpc xmlhttp xhr ajax dom bom utf ascii unicode ascii latn`.split(/\s+/));
const INDUSTRY_SPELL_ALLOWLIST = new Set(`jewell jewells jewelry jewellery jeweler jewelers jeweller jewellers karigar karigars hallmark hallmarked hallmarks karat karats carat carats bullion assay gst sgst cgst igst vat hsn sac tds itr eway einvoice crm erp scm pos eod sku skus rfid mcx nse bse fno demat upi neft rtgs barcode barcodes stockout stockouts bestseller bestsellers wholesaler wholesalers integrations integration manufacturing rupees rupee lakh lakhs crore crores paise anna sublist listitem menubar menuitem combobox textbox spinbutton whatsapp linkedin youtube facebook instagram pinterest tiktok karatgold rosegold whitegold`.split(/\s+/));
const SEO_CHECKLIST_WEIGHTS = { high: 14, medium: 7, low: 2 };

class SeoScanner {
  constructor() {
    this.spell = null;
  }

  async init() {
    if (!this.spell) {
      try {
        this.spell = nspell(dictionary);
        TECH_ALLOWLIST.forEach(w => this.spell.add(w));
        INDUSTRY_SPELL_ALLOWLIST.forEach(w => this.spell.add(w));
      } catch (e) {
        logger.warn('Spellchecker failed to load:', e.message);
      }
    }
  }

  isHttpOrHttpsUrl(urlStr) {
    try {
      const p = new URL(urlStr).protocol;
      return p === 'http:' || p === 'https:';
    } catch { return false; }
  }

  normalizeHost(d) {
    return String(d)
      .trim()
      .replace(/^https?[:/\\]+/i, '')
      .replace(/[/\\]+.*$/, '')
      .toLowerCase();
  }

  canonicalPageUrl(u) {
    try {
      const x = new URL(u);
      x.hash = '';
      x.pathname = x.pathname || '/';
      if (x.pathname.length > 1 && x.pathname.endsWith('/')) x.pathname = x.pathname.slice(0, -1);
      return x.href;
    } catch { return null; }
  }

  async fetchHeadStatus(urlStr, timeoutMs = 8000) {
    try {
      const r = await axios.head(urlStr, { timeout: timeoutMs, maxRedirects: 5, validateStatus: () => true });
      return r.status;
    } catch { return 0; }
  }

  async fetchGetTiming(urlStr, timeoutMs = 12000) {
    const t0 = performance.now();
    try {
      const r = await axios.get(urlStr, { timeout: timeoutMs, maxRedirects: 5, validateStatus: () => true, responseType: 'arraybuffer', maxContentLength: 5 * 1024 * 1024 });
      return { status: r.status, loadTimeSec: (performance.now() - t0) / 1000 };
    } catch { return { status: 0, loadTimeSec: (performance.now() - t0) / 1000 }; }
  }

  async getSslMeta(hostname) {
    return new Promise((resolve) => {
      const sock = tls.connect(443, { host: hostname, servername: hostname, rejectUnauthorized: false }, () => {
        try {
          const cert = sock.getPeerCertificate(true);
          const authorized = sock.authorized;
          sock.end();
          if (!cert || !cert.valid_to) return resolve({ sslValid: false, sslExpiryDate: null });
          const expiry = new Date(cert.valid_to).toISOString();
          const valid = authorized && cert.valid_from && cert.valid_to && new Date(cert.valid_to) > Date.now();
          resolve({ sslValid: !!valid, sslExpiryDate: expiry });
        } catch { sock.end(); resolve({ sslValid: false, sslExpiryDate: null }); }
      });
      sock.on('error', () => resolve({ sslValid: false, sslExpiryDate: null }));
      sock.setTimeout(10000, () => { sock.destroy(); resolve({ sslValid: false, sslExpiryDate: null }); });
    });
  }

  async fetchDomainFlags(baseOrigin) {
    const compliance = {
      privacy: false,
      terms: false,
      gdpr: false,
      cookieCompliance: false,
      termsUrl: null,
      keywordsFound: [],
      keywordsMissing: [...COMPLIANCE_KEYWORDS],
      isCompliant: false
    };
    try {
      const main = await axios.get(baseOrigin, { timeout: 15000, maxRedirects: 5, validateStatus: () => true });
      const html = String(main.data || '').toLowerCase();
      const $ = cheerio.load(String(main.data || ''));

      const links = $('a').toArray().map(el => ({
        text: $(el).text().toLowerCase().trim(),
        href: $(el).attr('href')
      }));

      // Identify T&C link
      const termsLink = links.find(l =>
        /terms of service|terms & conditions|terms and conditions|nutzungsbedingungen|agb/.test(l.text)
      );

      if (termsLink && termsLink.href) {
        compliance.terms = true;
        try {
          const absUrl = new URL(termsLink.href, baseOrigin).href;
          compliance.termsUrl = absUrl;

          // Fetch T&C page content
          const tcRes = await axios.get(absUrl, { timeout: 10000, maxRedirects: 5, validateStatus: () => true });
          const tcHtml = String(tcRes.data || '').toLowerCase();
          const tcText = cheerio.load(tcHtml)('body').text().toLowerCase();

          // Reset keywords specifically for this page scan
          compliance.keywordsFound = [];
          compliance.keywordsMissing = [];

          // Check keywords
          COMPLIANCE_KEYWORDS.forEach(kw => {
            if (tcText.includes(kw.toLowerCase())) {
              compliance.keywordsFound.push(kw);
            } else {
              compliance.keywordsMissing.push(kw);
            }
          });

          compliance.isCompliant = compliance.keywordsMissing.length === 0;
        } catch (e) {
          logger.warn(`Could not fetch T&C page at ${termsLink.href}: ${e.message}`);
        }
      }

      const linkTextBlob = links.map(l => l.text + ' ' + (l.href || '')).join(' ');
      const blob = html + ' ' + linkTextBlob;

      compliance.privacy = /privacy|privacy policy|datenschutz/.test(blob);
      compliance.gdpr = /gdpr|dsgvo|general data protection/.test(blob);
      compliance.cookieCompliance = /cookie policy|cookie consent|cookiesettings|accept cookies|we use cookies/.test(blob);
    } catch { /* ignore */ }
    return compliance;
  }

  async fetchRobotsSitemapPresent(origin) {
    let robotsTxtPresent = false, sitemapXmlPresent = false;
    try {
      const r = await axios.get(`${origin}/robots.txt`, { timeout: 8000, validateStatus: () => true });
      robotsTxtPresent = r.status === 200 && /user-agent|disallow|sitemap/i.test(String(r.data || ''));
    } catch { }
    try {
      const s = await axios.get(`${origin}/sitemap.xml`, { timeout: 8000, validateStatus: () => true });
      sitemapXmlPresent = s.status === 200 && /<urlset|<sitemapindex/i.test(String(s.data || ''));
    } catch { }
    return { robotsTxtPresent, sitemapXmlPresent };
  }

  async check404Page(origin) {
    try {
      const url = `${origin}/404-page-test-${Math.random().toString(36).substring(7)}`;
      const r = await axios.get(url, { timeout: 8000, validateStatus: () => true });
      return r.status === 404;
    } catch { return false; }
  }

  keywordDensityFromText(text, topN = 8) {
    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
    const freq = {};
    for (const w of words) freq[w] = (freq[w] || 0) + 1;
    const total = words.length || 1;
    const out = {};
    Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, topN).forEach(([w, c]) => { out[w] = Math.round((c / total) * 1000) / 10; });
    return out;
  }

  calculateReadability(text) {
    if (!text || text.length < 50) return 0;
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (words.length === 0 || sentences.length === 0) return 0;

    // Simple syllable count heuristic
    const syllableCount = words.reduce((acc, word) => {
      const w = word.toLowerCase().replace(/[^a-z]/g, '');
      if (w.length <= 3) return acc + 1;
      const syllables = w.match(/[aeiouy]{1,2}/g);
      return acc + (syllables ? syllables.length : 1);
    }, 0);

    const grade = 0.39 * (words.length / sentences.length) + 11.8 * (syllableCount / words.length) - 15.59;
    return Math.max(0, Math.min(20, grade)); // Clamp between 0 and 20
  }

  async fetchGoogleSuggestions(word) {
    try {
      const res = await axios.get(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(word)}`, {
        timeout: 3000,
        validateStatus: () => true
      });
      if (res.status === 200 && Array.isArray(res.data) && Array.isArray(res.data[1])) {
        return res.data[1];
      }
    } catch (err) {
      logger.warn(`Google suggestion fetch failed for ${word}: ${err.message}`);
    }
    return [];
  }

  async analyzeSpelling(text) {
    if (!this.spell) return { count: 0, keywords: [], corrections: [] };
    const tokens = String(text).toLowerCase().match(/\b[a-z]{2,}(?:'[a-z]+)?\b/g) || [];
    const missCounts = new Map();
    tokens.slice(0, 12000).forEach(raw => {
      const w = raw.replace(/^'+|'+$/g, '');
      if (w.length < 3 || STOP_WORDS.has(w) || TECH_ALLOWLIST.has(w) || INDUSTRY_SPELL_ALLOWLIST.has(w)) return;
      if (w.length >= 16 && /^[a-z]+$/.test(w)) return;
      if (this.spell.correct(w)) return;
      missCounts.set(w, (missCounts.get(w) || 0) + 1);
    });
    const sorted = [...missCounts.entries()].sort((a, b) => b[1] - a[1]);
    
    const correctionsToProcess = sorted.slice(0, 20);
    const corrections = await Promise.all(
      correctionsToProcess.map(async ([w]) => {
        const googleSuggestions = await this.fetchGoogleSuggestions(w);
        const localSuggestions = this.spell.suggest(w).slice(0, 5);
        const finalSuggestions = googleSuggestions.length > 0 ? googleSuggestions : localSuggestions;
        return {
          word: w,
          suggestions: finalSuggestions
        };
      })
    );

    return {
      count: [...missCounts.values()].reduce((a, b) => a + b, 0),
      keywords: sorted.slice(0, 45).map(([w]) => w),
      corrections
    };
  }

  analyzeWriting(text) {
    const t = String(text || '').trim();
    if (t.length < 120) return [];
    try {
      return writeGood(t.slice(0, 80000)).slice(0, 15).map(s => ({
        reason: s.reason,
        snippet: t.slice(s.index, s.index + Math.min(s.offset, 120)).replace(/\s+/g, ' ').trim()
      }));
    } catch { return []; }
  }

  async runLighthouse(url, chromePort) {
    const { default: lighthouse } = await import('lighthouse');
    const options = { logLevel: 'silent', output: 'json', port: chromePort, onlyCategories: ['performance', 'seo', 'accessibility'] };
    const runner = await lighthouse(url, options);
    return JSON.parse(runner.report);
  }

  async runPageSpeedApi(url) {
    const apiKey = process.env.PAGE_SPEED_API_KEY;
    if (!apiKey) return null;

    try {
      logger.info(`🚀 [PageSpeed API] Fetching metrics for ${url}...`);
      const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&key=${apiKey}&category=PERFORMANCE&category=ACCESSIBILITY&category=SEO&strategy=mobile`;
      const response = await axios.get(apiUrl, { timeout: 60000 });
      const result = response.data.lighthouseResult;
      const score = Math.round((result?.categories?.performance?.score ?? 0) * 100);
      logger.info(`✅ [PageSpeed API] Score for ${url}: ${score}`);
      return result;
    } catch (error) {
      const msg = error.response?.data?.error?.message || error.message;
      logger.warn(`⚠️ [PageSpeed API] Failed for ${url}: ${msg}`);
      return null;
    }
  }

  seoScoreFromChecklist(improvements) {
    let off = 0;
    improvements.forEach(imp => { off += SEO_CHECKLIST_WEIGHTS[imp.priority] ?? 5; });
    return Math.max(0, 100 - off);
  }

  buildSeoImprovements(ctx) {
    const list = [];
    const { $, images, textMetrics, meta, links, performance: perf, headings, additionalChecks, security, status, cssAnalysis, jsAnalysis } = ctx;
    const title = (meta.title || '').trim();

    // --- Meta & Structure ---
    if (title.length > 0 && title.length < 30) list.push({ type: 'title', priority: 'high', message: 'Title tag is short (30-60 chars recommended).', wisdom: 'Search engines use titles to understand your page. A short title might not provide enough context for users or algorithms.', details: { length: title.length } });
    if (title.length > 65) list.push({ type: 'title', priority: 'medium', message: 'Title may truncate in search results.', wisdom: 'Titles longer than 60-65 characters are often cut off by Google, potentially hiding your brand or key keywords.', details: { length: title.length } });
    if (!title) list.push({ type: 'title', priority: 'high', message: 'Missing title tag.', wisdom: 'Every page needs a unique title tag to describe its content to search engines and users.', details: { length: 0 } });

    const desc = (meta.description || '').trim();
    if (!desc) list.push({ type: 'meta', priority: 'high', message: 'Missing meta description.', wisdom: 'Meta descriptions summarize your page content in search results. Without one, search engines will pick random text.', details: { length: 0 } });
    else if (desc.length < 50) list.push({ type: 'meta', priority: 'medium', message: 'Meta description is too short.', wisdom: 'Aim for 50-160 characters. A very short description may not capture enough interest to drive clicks.', details: { length: desc.length } });
    else if (desc.length > 160) list.push({ type: 'meta', priority: 'low', message: 'Meta description is too long.', wisdom: 'Descriptions longer than 160 characters are usually truncated. Keep your primary message at the start.', details: { length: desc.length } });

    if (!$('html').attr('lang')) list.push({ type: 'structure', priority: 'medium', message: 'Missing HTML lang attribute.', wisdom: 'The lang attribute helps search engines and browsers identify the language of your content.', details: {} });
    if ($('link[rel~="icon"]').length === 0 && $('link[rel~="shortcut icon"]').length === 0) list.push({ type: 'structure', priority: 'low', message: 'Missing favicon.', wisdom: 'A favicon helps your site stand out in browser tabs and mobile search results.', details: {} });

    if (headings) {
      if (headings.h1 === 0) list.push({ type: 'headings', priority: 'high', message: 'Critical: Missing H1 heading.', wisdom: 'The H1 tag is the most important heading on your page. It tells both users and search engines what the page is about.', details: { h1: 0 } });
      else if (headings.h1 > 1) list.push({ type: 'headings', priority: 'medium', message: 'Multiple H1 tags detected.', wisdom: 'Using more than one H1 can confuse search engines about the primary topic of the page. Stick to one clear H1.', details: { h1: headings.h1 } });
    }

    if (/\bnoindex\b/.test((meta.robots || '').toLowerCase())) list.push({ type: 'indexing', priority: 'high', message: 'Page is blocked from indexing (noindex).', wisdom: 'The noindex tag prevents search engines from showing this page in search results. Remove it if this page should be public.', details: { robots: meta.robots } });

    // --- Performance Metrics (Wise & Actionable) ---
    if (perf?.coreWebVitals) {
      const v = perf.coreWebVitals;

      // LCP
      if (v.LCP > 2.5) {
        list.push({
          type: 'performance', priority: 'high',
          message: `LCP is slow (${v.LCP.toFixed(2)}s).`,
          wisdom: 'Largest Contentful Paint measures when the main content of your page is visible. Aim for < 2.5s. Slow LCP usually means heavy images or slow server response.',
          details: { LCP: v.LCP }
        });
      }

      // FCP
      if (v.FCP > 1.8) {
        list.push({
          type: 'performance', priority: 'medium',
          message: `FCP needs improvement (${v.FCP.toFixed(2)}s).`,
          wisdom: 'First Contentful Paint tracks when the first text or image is rendered. Over 1.8s makes users feel the site is unresponsive.',
          details: { FCP: v.FCP }
        });
      }

      // INP
      if (v.INP > 0.2) {
        list.push({
          type: 'performance', priority: 'high',
          message: `Interaction to Next Paint (INP) is high (${v.INP.toFixed(2)}s).`,
          wisdom: 'INP measures responsiveness to user input (clicks/taps). Poor INP ( > 200ms) creates a laggy feeling. Check for heavy JS execution.',
          details: { INP: v.INP }
        });
      }

      // CLS
      if (v.CLS > 0.1) {
        list.push({
          type: 'performance', priority: 'medium',
          message: `CLS is high (${v.CLS.toFixed(3)}).`,
          wisdom: 'Cumulative Layout Shift measures visual stability. High CLS causes elements to "jump," leading to accidental clicks and user frustration.',
          details: { CLS: v.CLS }
        });
      }

      // TBT
      if (v.TBT > 0.2) {
        list.push({
          type: 'performance', priority: 'medium',
          message: `Total Blocking Time is high (${v.TBT.toFixed(3)}s).`,
          wisdom: 'TBT shows how long the main thread was blocked during load. High TBT prevents users from interacting with the page immediately.',
          details: { TBT: v.TBT }
        });
      }

      // Speed Index
      if (v.SpeedIndex > 3.4) {
        list.push({
          type: 'performance', priority: 'low',
          message: `Speed Index is high (${v.SpeedIndex.toFixed(2)}s).`,
          wisdom: 'Speed Index measures how quickly content is visually displayed during page load. Use image compression and CDN for better results.',
          details: { SpeedIndex: v.SpeedIndex }
        });
      }
    }

    // --- CSS Analysis (Impact on Speed) ---
    if (cssAnalysis) {
      if (cssAnalysis.internalCssSize > 50000) { // 50KB threshold
        list.push({
          type: 'css', priority: 'medium',
          message: `Large internal CSS detected (${(cssAnalysis.internalCssSize / 1024).toFixed(1)}KB).`,
          wisdom: 'Internal <style> blocks cannot be cached by browsers and bloat the HTML. Move large styles to an external CSS file.',
          details: cssAnalysis
        });
      }
      if (cssAnalysis.inlineCssCount > 50) {
        list.push({
          type: 'css', priority: 'low',
          message: `Excessive inline styles (${cssAnalysis.inlineCssCount} elements).`,
          wisdom: 'Inline "style" attributes make HTML harder to maintain and increase document size. Use CSS classes instead.',
          details: cssAnalysis
        });
      }
    }

    // --- JS Analysis (Impact on Execution) ---
    if (jsAnalysis) {
      if (jsAnalysis.internalJsSize > 100000) { // 100KB threshold
        list.push({
          type: 'js', priority: 'medium',
          message: `Large internal JS detected (${(jsAnalysis.internalJsSize / 1024).toFixed(1)}KB).`,
          wisdom: 'Large internal script blocks increase HTML size and cannot be cached. Move scripts to external .js files for better performance.',
          details: jsAnalysis
        });
      }
      if (jsAnalysis.internalJsCount > 20) {
        list.push({
          type: 'js', priority: 'low',
          message: `Multiple internal script tags (${jsAnalysis.internalJsCount}).`,
          wisdom: 'Consolidate multiple small script tags into a single external file to reduce DOM complexity.',
          details: jsAnalysis
        });
      }
    }

    // --- Quality & Links ---
    if (images.withoutAlt > 0) list.push({ type: 'images', priority: 'medium', message: `Add alt text to ${images.withoutAlt} image(s).`, count: images.withoutAlt, wisdom: 'Alt text improves accessibility for screen readers and helps search engines understand image content.', details: images.missingAltDetails.slice(0, 10) });
    
    const largeImagesCount = (images.imageLoadDetails || []).filter(img => {
      const sizeStr = String(img.size || '0').toLowerCase();
      if (sizeStr.includes('mb')) return true;
      if (sizeStr.includes('kb')) {
        const kb = parseFloat(sizeStr);
        return kb > 150;
      }
      return false;
    }).length;
    if (largeImagesCount > 0) list.push({ type: 'images', priority: 'medium', message: `${largeImagesCount} large images detected (>150KB).`, count: largeImagesCount, wisdom: 'Large images significantly slow down page load. Use modern formats like WebP and compress them.', details: images.imageLoadDetails.filter(img => String(img.size).includes('MB') || parseFloat(img.size) > 150).slice(0, 10) });

    if (textMetrics.wordCount > 0 && textMetrics.wordCount < 300) list.push({ type: 'content', priority: 'low', message: 'Low content word count (< 300 words).', wisdom: 'Pages with very little text are often considered "thin content" and may struggle to rank for competitive keywords.', details: { words: textMetrics.wordCount } });
    if (textMetrics.spellingMistakesCount > 0) list.push({ type: 'spelling', priority: 'low', message: `Review ${textMetrics.spellingMistakesCount} spelling issues.`, count: textMetrics.spellingMistakesCount, wisdom: 'Correct spelling builds trust with users and signals high-quality content to search engines.', details: textMetrics.spellingCorrections?.slice(0, 10) });
    if (links.broken > 0) list.push({ type: 'links', priority: 'medium', message: `Fix ${links.broken} broken links.`, count: links.broken, wisdom: 'Broken links create a poor user experience and stop search engines from crawling your site effectively.', details: links.brokenDetails.slice(0, 10) });
    if (perf?.renderBlockingResources?.length > 0) list.push({ type: 'performance', priority: 'medium', message: 'Reduce render-blocking resources.', wisdom: 'Styles and scripts in the <head> block page rendering. Use "async" or "defer" for scripts and optimize CSS delivery.', details: perf.renderBlockingResources.slice(0, 10) });

    if (additionalChecks?.canonicalConflicts) list.push({ type: 'canonical', priority: 'high', message: 'Canonical URL mismatch.', wisdom: 'Ensure the canonical link points to the preferred version of the URL to avoid duplicate content issues.', details: { canonical: meta.canonical } });
    if (security?.mixedContent) list.push({ type: 'security', priority: 'high', message: 'Mixed HTTP content detected.', wisdom: 'Loading insecure assets on an HTTPS page triggers security warnings and can block content.', details: [] });

    // --- Compliance Checks ---
    if (additionalChecks?.compliance) {
      const comp = additionalChecks.compliance;
      if (!comp.terms) {
        list.push({
          type: 'compliance', priority: 'high',
          message: 'Compulsory: Missing Terms and Conditions page.',
          wisdom: `Terms and Conditions define the legal relationship with your users. Their absence is a significant legal and trust risk. Missing critical references like: ${COMPLIANCE_KEYWORDS.slice(0, 5).join(', ')}...`,
          details: { termsFound: false, missingKeywords: COMPLIANCE_KEYWORDS }
        });
      } else if (comp.keywordsMissing?.length > 0) {
        list.push({
          type: 'compliance', priority: 'medium',
          message: 'Terms & Conditions is missing key legal clauses.',
          wisdom: 'Your Terms and Conditions page is present but missing critical clauses (such as refund/cancellation policies or liability limits). Ensure these terms are fully defined.',
          details: { missingKeywords: comp.keywordsMissing }
        });
      }
    }

    return list.sort((a, b) => (SEO_CHECKLIST_WEIGHTS[b.priority] || 0) - (SEO_CHECKLIST_WEIGHTS[a.priority] || 0));
  }

  async scanPage(browser, pageUrl, host, origin, sslMeta, domainFlags, robotsSitemap, options = {}) {
    const { executeJs = false } = options;
    const chromePort = Number(new URL(browser.wsEndpoint()).port);
    const page = await browser.newPage();

    // Enable/Disable JS
    await page.setJavaScriptEnabled(executeJs);

    await page.setViewport({ width: 1366, height: 768 });

    // --- Network Tracking Setup ---
    const resourceMap = new Map();
    const networkResources = [];

    await page.setRequestInterception(false); // Make sure we're not blocking anything

    page.on('request', request => {
      const url = request.url();
      if (!url.startsWith('data:')) {
        resourceMap.set(url, {
          url,
          startTime: performance.now(),
          type: request.resourceType(),
          method: request.method()
        });
      }
    });

    page.on('response', response => {
      const url = response.url();
      const res = resourceMap.get(url);
      if (res) {
        res.status = response.status();
        res.headers = response.headers();
        res.fromCache = response.fromCache();
        res.fromServiceWorker = response.fromServiceWorker();
        // size can be tricky, encodedDataLength is usually what we want if available
        // but we might need to get it after requestfinished
      }
    });

    page.on('requestfinished', async (request) => {
      const url = request.url();
      const res = resourceMap.get(url);
      if (res) {
        res.endTime = performance.now();
        res.loadDuration = (res.endTime - res.startTime).toFixed(2) + 'ms';

        try {
          const response = request.response();
          if (response) {
            const headers = response.headers();
            let sizeBytes = 0;

            // Try content-length first
            if (headers['content-length']) {
              sizeBytes = parseInt(headers['content-length'], 10);
            }

            res.sizeBytes = sizeBytes;
            res.size = res.sizeBytes > 0 ? (res.sizeBytes > 1024 * 1024 ? (res.sizeBytes / (1024 * 1024)).toFixed(2) + 'MB' : (res.sizeBytes / 1024).toFixed(2) + 'KB') : '0KB';
          }
        } catch (e) { }

        networkResources.push({
          url: res.url,
          type: res.type,
          status: res.status,
          startTime: res.startTime,
          endTime: res.endTime,
          loadDuration: res.loadDuration,
          size: res.size,
          sizeBytes: res.sizeBytes || 0
        });
      }
    });

    let status = 200, redirects = [], finalUrl = pageUrl;
    const tNav0 = performance.now();
    try {
      const response = await page.goto(pageUrl, {
        waitUntil: executeJs ? 'networkidle2' : 'domcontentloaded',
        timeout: 60000
      });
      if (response) {
        status = response.status();
        redirects = response.request().redirectChain().map(r => r.url());
        finalUrl = response.url();
      }
    } catch (e) {
      logger.warn(`Failed to goto ${pageUrl}: ${e.message}`);
      status = 0;
      throw new Error(`Could not reach the domain: ${pageUrl}. HTTP Status: 0`);
    }

    if (status === 0) {
      throw new Error(`Could not reach the domain: ${pageUrl}. HTTP Status: 0`);
    }
    const tNavMs = performance.now() - tNav0;

    // --- Wait for Images to Load ---
    // --- Wait for Images to Load (Robustly) ---
    try {
      // Use a race to avoid global protocol timeout
      await Promise.race([
        page.evaluate(async () => {
          const imgs = Array.from(document.querySelectorAll('img'));
          const promises = imgs.map(img => {
            if (img.complete && img.naturalWidth !== undefined) return Promise.resolve();
            return new Promise(resolve => {
              img.onload = resolve;
              img.onerror = resolve;
              setTimeout(resolve, 8000); // 8s per image
            });
          });
          await Promise.all(promises);
        }),
        new Promise(resolve => setTimeout(resolve, 15000)) // 15s total cap for this step
      ]);
      // Small buffer to allow network events to catch up
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      logger.warn(`Wait for images encountered an issue (non-critical): ${e.message}`);
    }

    // --- Performance API Metrics ---
    const perfTiming = await page.evaluate(() => {
      const t = performance.getEntriesByType('navigation')[0];
      if (!t) return null;
      return {
        domContentLoaded: t.domContentLoadedEventEnd - t.startTime,
        loadEvent: t.loadEventEnd - t.startTime,
        ttfb: t.responseStart - t.requestStart,
        totalTime: t.loadEventEnd - t.startTime
      };
    });

    // --- CSS Analysis ---
    const cssAnalysis = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style'));
      const internalCssSize = styles.reduce((acc, s) => acc + (s.textContent || '').length, 0);
      const inlineCssCount = document.querySelectorAll('[style]').length;
      return {
        internalCssSize,
        internalCssCount: styles.length,
        inlineCssCount,
        totalCssImpact: internalCssSize > 50000 || inlineCssCount > 50 ? 'High' : (internalCssSize > 10000 ? 'Medium' : 'Low'),
        recommendation: internalCssSize > 50000 ? 'Move internal styles to external files.' : (inlineCssCount > 50 ? 'Reduce inline styles.' : 'CSS delivery is optimized.')
      };
    });

    // --- JS Analysis ---
    const jsAnalysis = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script:not([src])'));
      const internalJsSize = scripts.reduce((acc, s) => acc + (s.textContent || '').length, 0);
      return {
        internalJsSize,
        internalJsCount: scripts.length,
        totalJsImpact: internalJsSize > 100000 ? 'High' : (internalJsSize > 20000 ? 'Medium' : 'Low'),
        recommendation: internalJsSize > 100000 ? 'Large internal script blocks detected. Consider moving to external files.' : 'Internal JS usage is within acceptable limits.'
      };
    });

    // --- Image Detailed Analysis ---
    const imageDetails = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img')).map(img => ({
        src: img.src,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        alt: img.alt,
        loading: img.getAttribute('loading') || 'eager'
      }));
    });

    const detailedImages = imageDetails.map(img => {
      // Find resource by URL, ignoring fragments and normalizing
      const normalize = (u) => u.split('#')[0].replace(/\/$/, '');
      const imgUrlNorm = normalize(img.src);

      let netRes = networkResources.find(r => normalize(r.url) === imgUrlNorm);

      // Fallback: search for partial match if exact match fails (e.g. redirected or relative issues)
      if (!netRes) {
        netRes = networkResources.find(r => r.url.includes(imgUrlNorm) || imgUrlNorm.includes(r.url));
      }

      return {
        url: img.src,
        alt: img.alt,
        size: netRes ? netRes.size : 'Unknown',
        sizeBytes: netRes ? netRes.sizeBytes : 0,
        loadTime: netRes ? netRes.loadDuration : 'Unknown',
        loadTimeMs: netRes ? (netRes.endTime - netRes.startTime) : 0,
        lazy: img.loading === 'lazy',
        naturalSize: img.naturalWidth > 0 ? `${img.naturalWidth}x${img.naturalHeight}` : 'Unknown (Not Loaded)',
        hasAlt: !!img.alt,
        statusCode: netRes?.status ?? null,
      };
    });
    const html = await page.content();
    const $ = cheerio.load(html);
    const bodyText = $('body').text() || '';
    
    const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
    const spelling = await this.analyzeSpelling(bodyText);
    const writingHints = this.analyzeWriting(bodyText);
    const headingTexts = [];
    $('h1, h2, h3, h4, h5, h6').each((i, el) => {
      headingTexts.push($(el).text().trim());
    });
    const headings = { 
      h1: $('h1').length, 
      h2: $('h2').length, 
      h3: $('h3').length, 
      h4: $('h4').length, 
      h5: $('h5').length, 
      h6: $('h6').length, 
      paragraphs: $('p').length, 
      lists: { ul: $('ul').length, ol: $('ol').length },
      headingDetails: headingTexts
    };
    const textMetrics = {
      wordCount,
      readabilityScore: this.calculateReadability(bodyText),
      keywordDensity: this.keywordDensityFromText(bodyText),
      textToHtmlRatio: html.length > 0 ? (Math.round((wordCount / html.length) * 1000) / 1000) : 0,
      duplicateContent: false,
      spellingMistakesCount: spelling.count,
      spellingMistakesKeywords: spelling.keywords,
      spellingCorrections: spelling.corrections,
      writingHints,
      emails: [...new Set(bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])]
    };

    const hostNorm = host.replace(/^www\./, '');
    const allAnchors = $('a').toArray();
    logger.info(`🔍 [Scraper] HTML length: ${html.length} | Body length: ${bodyText.length} | Total <a> tags: ${allAnchors.length}`);
    
    const anchorRows = allAnchors.map(el => {
      const href = $(el).attr('href');
      if (!href) return null;
      try {
        const abs = new URL(href, finalUrl).href;
        const hn = new URL(abs).hostname.replace(/^www\./, '').toLowerCase();
        return { url: abs, anchorText: $(el).text().trim().slice(0, 240), rel: $(el).attr('rel'), internal: hn === hostNorm };
      } catch { return null; }
    }).filter(Boolean);

    const internalUrls = [...new Set(anchorRows.filter(r => r.internal).map(r => r.url))];
    const externalUrls = [...new Set(anchorRows.filter(r => !r.internal).map(r => r.url))];
    
    logger.info(`🔗 [Link Extraction] Page: ${finalUrl} | hostNorm: ${hostNorm} | Found ${anchorRows.length} total links (${internalUrls.length} internal)`);
    if (anchorRows.length > 0 && internalUrls.length === 0) {
      logger.info(`⚠️ [Internal Link Warning] Samples of detected links: ${anchorRows.slice(0, 3).map(r => r.url).join(', ')}`);
    }

    // --- Late T&C Detection (SPA support) ---
    if (!domainFlags.terms) {
      const termsLink = anchorRows.find(l =>
        /terms of service|terms & conditions|terms and conditions|nutzungsbedingungen|agb/i.test(l.anchorText)
      );
      if (termsLink && termsLink.url) {
        domainFlags.terms = true;
        domainFlags.termsUrl = termsLink.url;
        try {
          const tcPage = await browser.newPage();
          await tcPage.goto(termsLink.url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
          const tcText = await tcPage.evaluate(() => document.body.innerText.toLowerCase()).catch(() => '');
          
          if (tcText.length > 100) {
            domainFlags.keywordsFound = [];
            domainFlags.keywordsMissing = [];
            COMPLIANCE_KEYWORDS.forEach(kw => {
              if (tcText.includes(kw.toLowerCase())) domainFlags.keywordsFound.push(kw);
              else domainFlags.keywordsMissing.push(kw);
            });
            domainFlags.isCompliant = domainFlags.keywordsMissing.length === 0;
            logger.info(`✅ [Late Detection] Found T&C at ${termsLink.url}`);
          }
          await tcPage.close();
        } catch (e) {
          logger.warn(`Could not verify late-detected T&C at ${termsLink.url}: ${e.message}`);
        }
      }
    }

    const sample = [...new Set([...internalUrls, ...externalUrls])].filter(u => this.isHttpOrHttpsUrl(u)).slice(0, 100);
    const brokenDetails = [];
    for (const u of sample) { if ((await this.fetchHeadStatus(u)) >= 400) brokenDetails.push(u); }
    const imageAnalysis = {
      total: detailedImages.length,
      withAlt: detailedImages.filter(i => i.hasAlt).length,
      withoutAlt: detailedImages.filter(i => !i.hasAlt).length,
      totalSize: (detailedImages.reduce((sum, i) => sum + i.sizeBytes, 0) / 1024).toFixed(2) + 'KB',
      imageLoadDetails: detailedImages.map(i => ({
        url: i.url,
        alt: i.alt,
        size: i.size,
        sizeBytes: i.sizeBytes,
        loadTime: i.loadTime,
        lazy: i.lazy,
        naturalSize: i.naturalSize,
        statusCode: i.statusCode,
      })),
      missingAltDetails: detailedImages.filter(i => !i.hasAlt).map(i => i.url).slice(0, 30),
      lazyLoaded: detailedImages.filter(i => i.lazy).length,
    };

    // --- Loading Summary ---
    const slowestResource = networkResources.length > 0 ? networkResources.reduce((prev, current) => {
      const prevTime = prev.endTime - prev.startTime;
      const currTime = current.endTime - current.startTime;
      return (currTime > prevTime) ? current : prev;
    }) : null;

    const heaviestResource = networkResources.length > 0 ? networkResources.reduce((prev, current) => {
      return (current.sizeBytes > prev.sizeBytes) ? current : prev;
    }) : null;

    const avgResourceLoadTime = networkResources.length > 0
      ? (networkResources.reduce((sum, r) => sum + (r.endTime - r.startTime), 0) / networkResources.length).toFixed(2) + 'ms'
      : '0ms';

    const loadingSummary = {
      totalLoadTime: (perfTiming?.loadEvent || tNavMs).toFixed(2) + 'ms',
      avgResourceLoadTime,
      slowestResource: slowestResource ? { url: slowestResource.url, loadTime: slowestResource.loadDuration } : null,
      largestResource: heaviestResource ? { url: heaviestResource.url, size: heaviestResource.size } : null
    };

    const networkMetrics = {
      totalRequests: networkResources.length,
      totalTransferredSize: (networkResources.reduce((sum, r) => sum + r.sizeBytes, 0) / 1024).toFixed(2) + 'KB',
      jsSize: (networkResources.filter(r => r.type === 'script').reduce((sum, r) => sum + r.sizeBytes, 0) / 1024).toFixed(2) + 'KB',
      cssSize: (networkResources.filter(r => r.type === 'stylesheet').reduce((sum, r) => sum + r.sizeBytes, 0) / 1024).toFixed(2) + 'KB',
      imageSize: (networkResources.filter(r => r.type === 'image').reduce((sum, r) => sum + r.sizeBytes, 0) / 1024).toFixed(2) + 'KB',
      resourceCount: {
        js: networkResources.filter(r => r.type === 'script').length,
        css: networkResources.filter(r => r.type === 'stylesheet').length,
        image: networkResources.filter(r => r.type === 'image').length,
        font: networkResources.filter(r => r.type === 'font').length,
        xhr: networkResources.filter(r => r.type === 'xhr' || r.type === 'fetch').length
      }
    };
    const allMeta = [];
    $('meta').each((i, el) => {
      const name = $(el).attr('name') || $(el).attr('property') || $(el).attr('http-equiv');
      const content = $(el).attr('content');
      if (name && content) allMeta.push({ name, content });
    });

    const meta = {
      title: $('title').first().text().trim(),
      description: $('meta[name="description"]').attr('content') || '',
      robots: $('meta[name="robots"]').attr('content') || '',
      canonical: $('link[rel="canonical"]').attr('href') || '',
      hreflang: $('link[rel="alternate"][hreflang]').toArray().map(el => $(el).attr('hreflang')),
      openGraph: { title: $('meta[property="og:title"]').attr('content'), description: $('meta[property="og:description"]').attr('content'), image: $('meta[property="og:image"]').attr('content') },
      allMeta
    };
    let performanceBlock = { pageLoadTime: tNavMs / 1000, coreWebVitals: { LCP: 0, FID: 0, CLS: 0, TBT: 0 }, renderBlockingResources: [] };
    let lighthouseSeoScore = 0;
    let lighthouseAccessibilityScore = 0;
    let lighthousePerformanceScore = 0;
    if (status > 0 && status < 400) {
      try {
        // Allow the page to "settle" briefly before handing over to Lighthouse
        // This helps prevent "performance mark not set" errors
        await new Promise(r => setTimeout(r, 2000));

        let lhReport;
        let attempts = 0;
        const maxAttempts = 2;

        // Try PageSpeed API first
        lhReport = await this.runPageSpeedApi(finalUrl);

        if (!lhReport) {
          logger.info(`🏠 [Lighthouse] Falling back to local Lighthouse for ${finalUrl}`);
          while (attempts < maxAttempts) {
            try {
              lhReport = await this.runLighthouse(finalUrl, chromePort);
              break; // Success
            } catch (lhErr) {
              attempts++;
              if (attempts >= maxAttempts) throw lhErr;
              logger.warn(`Lighthouse attempt ${attempts} failed for ${finalUrl}: ${lhErr.message}. Retrying...`);
              await new Promise(r => setTimeout(r, 3000));
            }
          }
        }



        const audits = lhReport.audits || {};
        lighthouseSeoScore = Math.round((lhReport.categories?.seo?.score ?? 0) * 100);
        lighthouseAccessibilityScore = Math.round((lhReport.categories?.accessibility?.score ?? 0) * 100);
        lighthousePerformanceScore = Math.round((lhReport.categories?.performance?.score ?? 0) * 100);
        
        logger.info(`📊 [Lighthouse] Results for ${finalUrl}: Performance: ${lighthousePerformanceScore}, SEO: ${lighthouseSeoScore}, Accessibility: ${lighthouseAccessibilityScore}`);
        
        performanceBlock = {
          pageLoadTime: (audits.interactive?.numericValue ?? tNavMs) / 1000,
          timeToFirstByte: (audits['server-response-time']?.numericValue ?? 0) / 1000,
          pageSizeKB: (audits['total-byte-weight']?.numericValue ?? html.length) / 1024,
          numberOfScripts: $('script[src]').length,
          numberOfCssFiles: $('link[rel="stylesheet"]').length,
          redirects,
          coreWebVitals: {
            LCP: (audits['largest-contentful-paint']?.numericValue ?? 0) / 1000,
            FID: (audits['max-potential-fid']?.numericValue ?? 0) / 1000,
            CLS: audits['cumulative-layout-shift']?.numericValue ?? 0,
            TBT: (audits['total-blocking-time']?.numericValue ?? 0) / 1000,
            FCP: (audits['first-contentful-paint']?.numericValue ?? 0) / 1000,
            SpeedIndex: (audits['speed-index']?.numericValue ?? 0) / 1000,
            SpeedIndex: (audits['speed-index']?.numericValue ?? 0) / 1000,
            INP: (audits['interactive']?.numericValue ?? 0) / 1000 // Fallback to TTI if INP audit is missing
          },
          advancedMetrics: {
            performanceScore: Math.round((lhReport.categories?.performance?.score ?? 0) * 100),
            domContentLoadedTime: (perfTiming?.domContentLoaded ?? 0) / 1000,
            fullyLoadedTime: (perfTiming?.loadEvent ?? 0) / 1000,
            totalPageLoadTime: (perfTiming?.totalTime ?? 0) / 1000
          },
          renderBlockingResources: (audits['render-blocking-resources']?.details?.items || []).map(i => i.url)
        };

        // Try to get actual INP if available (in newer Lighthouse versions)
        const accessibilityIssues = Object.values(audits).filter(a => 
          a.id && a.score !== null && a.score < 1 && 
          lhReport.categories?.accessibility?.auditRefs?.some(ref => ref.id === a.id)
        ).map(a => ({
          id: a.id,
          title: a.title,
          description: a.description,
          score: a.score,
          impact: a.score === 0 ? 'high' : 'medium',
          nodes: (a.details?.items || []).map(i => ({
            snippet: i.node?.snippet,
            selector: i.node?.selector,
            explanation: i.node?.explanation
          })).filter(n => n.snippet)
        }));

        performanceBlock.accessibility = {
          score: lighthouseAccessibilityScore,
          issues: accessibilityIssues
        };

        if (audits['interaction-to-next-paint']?.numericValue) {
          performanceBlock.coreWebVitals.INP = audits['interaction-to-next-paint'].numericValue / 1000;
        }

      } catch (e) { logger.error(`Lighthouse error for ${finalUrl}: ${e.message}`); }
    }
    const [hasCustom404] = await Promise.all([this.check404Page(origin)]);

    const additionalChecks = {
      structuredDataErrors: 0,
      robotsTxtPresent: robotsSitemap.robotsTxtPresent,
      sitemapXmlPresent: robotsSitemap.sitemapXmlPresent,
      canonicalConflicts: !!(meta.canonical && this.canonicalPageUrl(meta.canonical) !== this.canonicalPageUrl(finalUrl)),
      hasCustom404,
      compliance: domainFlags,
      formCount: $('form').length,
      iframeCount: $('iframe').length,
      frameCount: $('frame').length,
      formDetails: $('form').map((i, el) => $(el).attr('action') || $(el).attr('name') || $(el).attr('id') || 'Unnamed Form').get().map(url => ({ url })),
      iframeDetails: $('iframe').map((i, el) => $(el).attr('src') || $(el).attr('name') || 'Unnamed IFrame').get().map(url => ({ url })),
      frameDetails: $('frame').map((i, el) => $(el).attr('src') || $(el).attr('name') || 'Unnamed Frame').get().map(url => ({ url })),
      headLinks: $('head link').map((i, el) => $(el).attr('href')).get().filter(Boolean).map(url => ({ url }))
    };
    const security = sslMeta || { sslValid: false, sslExpiryDate: null };

    // --- File Categorization ---
    const isJs = (r) => r.type === 'script' || (r.url && (r.url.split('?')[0].endsWith('.js') || r.url.split('?')[0].endsWith('.mjs')));
    const isCss = (r) => r.type === 'stylesheet' || (r.url && r.url.split('?')[0].endsWith('.css'));
    const isImage = (r) => r.type === 'image' || (r.url && /\.(jpg|jpeg|png|gif|webp|svg|ico)(\?.*)?$/i.test(r.url));

    const files = {
      js: networkResources.filter(isJs).map(r => ({ url: r.url, size: r.size, loadTime: r.loadDuration })),
      css: networkResources.filter(isCss).map(r => ({ url: r.url, size: r.size, loadTime: r.loadDuration })),
      others: networkResources.filter(r => !isJs(r) && !isCss(r) && !isImage(r)).map(r => ({
        url: r.url,
        type: r.type,
        size: r.size,
        loadTime: r.loadDuration
      }))
    };

    const seoImprovements = this.buildSeoImprovements({ 
      $, 
      images: imageAnalysis, 
      textMetrics, 
      meta, 
      links: { broken: brokenDetails.length, brokenDetails }, 
      performance: performanceBlock, 
      headings, 
      additionalChecks, 
      security, 
      status, 
      cssAnalysis, 
      jsAnalysis 
    });
    const seoScore = this.seoScoreFromChecklist(seoImprovements);
    const report = {
      domain: host,
      url: finalUrl,
      httpStatus: status,
      scanDate: new Date().toISOString(),
      performance: performanceBlock,
      networkMetrics,
      resources: options.fullResourceReport ? networkResources : networkResources.slice(0, 50), // Option to bypass limit
      imageAnalysis,
      loadingSummary,
      headings,
      textMetrics,
      links: { 
        internal: internalUrls.length, 
        external: externalUrls.length, 
        internalUrls, 
        outboundUrls: externalUrls, 
        broken: brokenDetails.length, 
        brokenDetails,
        linkDetails: anchorRows 
      },
      images: imageAnalysis,
      files,
      meta,
      security,
      additionalChecks,
      cssAnalysis,
      jsAnalysis,
      accessibility: performanceBlock.accessibility,
      lighthouseSeoScore,
      lighthouseAccessibilityScore,
      lighthousePerformanceScore,
      seoScore,
      seoScoreOutOf: 100,
      seoImprovements
    };
    await page.close();
    return { report, internalUrls: internalUrls.filter(u => this.isHttpOrHttpsUrl(u)), html, bodyText };
  }

  async scanDomain(domainName, options = {}) {
    const { pageLimit = 500, scanSubdomains = true, executeJs = false, customUrls } = options;
    await this.init();
    const host = this.normalizeHost(domainName);
    if (!host || host.includes(':') || host.includes(' ') || host.length < 3) {
      throw new Error(`Invalid domain name provided: ${domainName}`);
    }
    const origin = `https://${host}`;
    const [sslMeta, domainFlags, robotsSitemap] = await Promise.all([this.getSslMeta(host), this.fetchDomainFlags(origin), this.fetchRobotsSitemapPresent(origin)]);
    const browser = await puppeteer.launch({
      headless: true,
      protocolTimeout: 240000, // Increase protocol timeout to 4 minutes
      ignoreHTTPSErrors: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1366,768']
    });
    try {
      const hasCustomUrls = Array.isArray(customUrls) && customUrls.length > 0;
      let queue = [];
      if (hasCustomUrls) {
        queue = customUrls.map(u => {
          let targetUrl = u.trim();
          if (targetUrl.startsWith('/')) {
            targetUrl = origin + targetUrl;
          } else if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            targetUrl = origin + '/' + targetUrl;
          }
          return this.canonicalPageUrl(targetUrl);
        }).filter(Boolean);
      } else {
        queue = [this.canonicalPageUrl(origin + '/')];
      }

      const visited = new Set(), reports = [];
      const hostNorm = host.replace(/^www\./, '');
 
      while (queue.length && reports.length < pageLimit) {
        const next = queue.shift();
        if (!next || visited.has(next)) continue;
        visited.add(next);
        
        logger.info(`🔍 [Crawl] Queue: ${queue.length} | Visited: ${visited.size} | Scanning: ${next}`);
        try {
          logger.info(`🔍 [Domain: ${host}] [Page ${reports.length + 1}/${pageLimit}] Scanning: ${next}`);
          const { report, internalUrls, html, bodyText } = await this.scanPage(browser, next, host, origin, sslMeta, domainFlags, robotsSitemap, { executeJs });
          reports.push({ ...report, html, bodyText });
          logger.info(`🔍 [Domain: ${host}] [Page ${reports.length}/${pageLimit}] Found ${internalUrls.length} internal links on ${next}`);
          
          if (!hasCustomUrls) {
            for (const u of internalUrls) {
              const c = this.canonicalPageUrl(u);
              if (!c || visited.has(c) || queue.includes(c)) continue;
              try {
                const uObj = new URL(c);
                const targetHost = uObj.hostname.replace(/^www\./, '').toLowerCase();
  
                if (scanSubdomains) {
                  if (targetHost === hostNorm || targetHost.endsWith('.' + hostNorm)) {
                    logger.info(`➕ [Queue] Adding: ${c} (targetHost: ${targetHost}, hostNorm: ${hostNorm})`);
                    queue.push(c);
                  } else {
                    logger.debug(`⏩ [Queue] Skipping external/subdomain: ${c} (targetHost: ${targetHost}, hostNorm: ${hostNorm})`);
                  }
                } else {
                  if (targetHost === hostNorm) {
                    logger.info(`➕ [Queue] Adding: ${c} (targetHost: ${targetHost}, hostNorm: ${hostNorm})`);
                    queue.push(c);
                  } else {
                    logger.debug(`⏩ [Queue] Skipping external: ${c} (targetHost: ${targetHost}, hostNorm: ${hostNorm})`);
                  }
                }
              } catch (urlErr) { 
                logger.warn(`❌ [Queue] Invalid URL: ${c} | Error: ${urlErr.message}`);
              }
            }
          }
        } catch (e) { 
          logger.error(`Error scanning page ${next}: ${e.message}`); 
          if (!hasCustomUrls && visited.size === 1) {
            throw new Error(`Root page failed: ${e.message}`);
          }
        }
      }
      return reports;
    } finally { await browser.close(); }
  }
}

const seoScanner = new SeoScanner();
export async function scanDomain(domainName, options) { return await seoScanner.scanDomain(domainName, options); }
export default scanDomain;
