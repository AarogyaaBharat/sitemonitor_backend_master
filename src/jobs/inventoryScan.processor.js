import axios from 'axios';
import * as cheerio from 'cheerio';
import https from 'https';
import { URL } from 'url';
import { DomainScanMasterSchema } from '../models/DomainScanMaster.js';
import { DomainPageSchema } from '../models/DomainPage.js';
import { PageImageSchema } from '../models/PageImage.js';
import { PageCssSchema } from '../models/PageCss.js';
import { PageJsSchema } from '../models/PageJs.js';
import { PageDocumentSchema } from '../models/PageDocument.js';
import { PageEmailSchema } from '../models/PageEmail.js';
import { PageHeadlinkSchema } from '../models/PageHeadlink.js';
import { PageLinkSchema } from '../models/PageLink.js';
import { PageFormSchema } from '../models/PageForm.js';
import { PageIframeSchema } from '../models/PageIframe.js';

import { PageFrameSchema } from '../models/PageFrame.js';
import { mongoMultiConnector } from '../services/mongoMultiConnector.js';
import { logger } from '../utils/logger.js';

// Document extensions to look for
const DOCUMENT_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'zip'];

// Quick HEAD request helper with GET/Range fallback to determine actual asset size without downloading the full body
const fetchAssetSize = async (url) => {
  try {
    // 1. Attempt rapid HEAD check
    let res = await axios.head(url, {
      timeout: 1000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
      },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      validateStatus: () => true
    });

    let len = res.headers['content-length'];

    // 2. Fallback to GET request with Range if HEAD failed or returned no length
    if (!len || res.status >= 400) {
      res = await axios.get(url, {
        timeout: 1200,
        headers: {
          'Range': 'bytes=0-1023',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
        },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        validateStatus: () => true
      });

      const contentRange = res.headers['content-range'];
      if (contentRange) {
        // Parse "bytes 0-1023/54320"
        const parts = contentRange.split('/');
        if (parts.length > 1) {
          const totalBytes = parseInt(parts[1], 10);
          if (!isNaN(totalBytes) && totalBytes > 0) {
            len = totalBytes;
          }
        }
      }

      if (!len) {
        len = res.headers['content-length'];
      }
    }

    if (len) {
      const bytes = parseInt(len, 10);
      if (!isNaN(bytes) && bytes > 0) {
        if (bytes >= 1048576) {
          return `${(bytes / 1048576).toFixed(1)} MB`;
        }
        if (bytes >= 1024) {
          return `${(bytes / 1024).toFixed(1)} KB`;
        }
        return `${bytes} B`;
      }
    }
  } catch (err) {
    // Ignore and fallback
  }
  return 'Unknown';
};

export const processInventoryScan = async (job) => {
  const { domainId, domainUrl, scanId, sourceDb, sourceUri } = job.data;
  const startTime = Date.now();

  logger.info(`[Inventory Scan] Starting background scan for scanId: ${scanId}, domain: ${domainUrl}`);

  let conn;
  try {
    // 1. Get client database connection
    conn = await mongoMultiConnector.getClientConnection(sourceUri, sourceDb);

    // 2. Resolve models dynamically on connection
    const DomainScanMaster = conn.model('DomainScanMaster', DomainScanMasterSchema);
    const DomainPage = conn.model('DomainPage', DomainPageSchema);
    const PageImage = conn.model('PageImage', PageImageSchema);
    const PageCss = conn.model('PageCss', PageCssSchema);
    const PageJs = conn.model('PageJs', PageJsSchema);
    const PageDocument = conn.model('PageDocument', PageDocumentSchema);
    const PageEmail = conn.model('PageEmail', PageEmailSchema);
    const PageHeadlink = conn.model('PageHeadlink', PageHeadlinkSchema);
    const PageLink = conn.model('PageLink', PageLinkSchema);
    const PageForm = conn.model('PageForm', PageFormSchema);
    const PageIframe = conn.model('PageIframe', PageIframeSchema);
    const PageFrame = conn.model('PageFrame', PageFrameSchema);

    // 3. Update status to 'scanning'
    const scanMaster = await DomainScanMaster.findById(scanId);
    if (!scanMaster) {
      throw new Error(`DomainScanMaster record not found for scanId: ${scanId}`);
    }
    scanMaster.status = 'scanning';
    scanMaster.scan_started_at = new Date();
    await scanMaster.save();

    // 4. Normalize host for crawling
    const parsedBase = new URL(domainUrl.startsWith('http') ? domainUrl : `https://${domainUrl}`);
    const origin = parsedBase.origin;
    const baseHost = parsedBase.hostname.replace(/^www\./, '').toLowerCase();

    // 5. Fetch robots.txt if enabled/available
    let robotsDisallows = [];
    try {
      const robotsRes = await axios.get(`${origin}/robots.txt`, {
        timeout: 5000,
        validateStatus: () => true,
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
      });
      if (robotsRes.status === 200) {
        const lines = robotsRes.data.split('\n');
        let isUserAgentAll = false;
        for (const line of lines) {
          const cleanLine = line.trim().toLowerCase();
          if (cleanLine.startsWith('user-agent:')) {
            const ua = cleanLine.split(':')[1].trim();
            isUserAgentAll = ua === '*';
          } else if (isUserAgentAll && cleanLine.startsWith('disallow:')) {
            const path = cleanLine.split(':')[1].trim();
            if (path) robotsDisallows.push(path);
          }
        }
        logger.info(`[Inventory Scan] Loaded ${robotsDisallows.length} disallow rules from robots.txt`);
      }
    } catch (e) {
      logger.info(`[Inventory Scan] No robots.txt or failed to fetch: ${e.message}`);
    }

    const isUrlBlocked = (urlStr) => {
      try {
        const pathname = new URL(urlStr).pathname;
        return robotsDisallows.some(dis => pathname.startsWith(dis));
      } catch {
        return false;
      }
    };

    // Helper functions for URL operations
    const canonicalPageUrl = (u) => {
      try {
        const x = new URL(u);
        x.hash = '';
        x.pathname = x.pathname || '/';
        if (x.pathname.length > 1 && x.pathname.endsWith('/')) {
          x.pathname = x.pathname.slice(0, -1);
        }
        return x.href;
      } catch {
        return null;
      }
    };

    const resolveUrl = (href, base) => {
      try {
        return new URL(href, base).href;
      } catch {
        return null;
      }
    };

    const isInternalUrl = (urlStr) => {
      try {
        const targetHost = new URL(urlStr).hostname.replace(/^www\./, '').toLowerCase();
        return targetHost === baseHost;
      } catch {
        return false;
      }
    };

    // 6. Crawling queue and status state
    const visited = new Set();
    const queue = [canonicalPageUrl(origin + '/')];
    const pageLimit = 150; // Dynamic limit, default to 150 for speed and stability
    const concurrency = 5; // Scan 5 pages in parallel

    // Keep track of counts for live progress
    let pagesCrawledCount = 0;
    let totalImagesCount = 0;
    let totalCssCount = 0;
    let totalJsCount = 0;
    let totalDocsCount = 0;
    let totalEmailsCount = 0;
    let totalHeadlinksCount = 0;

    while (queue.length > 0 && pagesCrawledCount < pageLimit) {
      // Pull a batch of URLs to scan in parallel
      const batch = [];
      while (queue.length > 0 && batch.length < concurrency && (pagesCrawledCount + batch.length) < pageLimit) {
        const nextUrl = queue.shift();
        if (nextUrl && !visited.has(nextUrl) && !isUrlBlocked(nextUrl)) {
          visited.add(nextUrl);
          batch.push(nextUrl);
        }
      }

      if (batch.length === 0) continue;

      logger.info(`[Inventory Scan] Scanning batch of size ${batch.length}. Visited total: ${visited.size}`);

      // Process batch in parallel
      await Promise.all(batch.map(async (url) => {
        let attempts = 0;
        let success = false;
        let res = null;

        while (attempts < 3 && !success) {
          attempts++;
          try {
            res = await axios.get(url, {
              timeout: 12000,
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SitemonitorInventoryScanner/1.0)' },
              validateStatus: () => true,
              httpsAgent: new https.Agent({ rejectUnauthorized: false })
            });
            success = true;
          } catch (err) {
            logger.warn(`[Inventory Scan] Attempt ${attempts} failed for ${url}: ${err.message}`);
            if (attempts < 3) await new Promise(r => setTimeout(r, 1500));
          }
        }

        if (!success || !res) {
          logger.error(`[Inventory Scan] Failed to reach ${url} after 3 attempts.`);
          return;
        }

        pagesCrawledCount++;
        const statusCode = res.status;
        const html = String(res.data || '');
        const $ = cheerio.load(html);
        const title = $('title').first().text().trim() || '(No Title)';

        // Write page record to DB
        try {
          await DomainPage.create({
            scan_id: scanId,
            domain_id: domainId,
            page_url: url,
            status_code: statusCode,
            page_title: title
          });
        } catch (dbErr) {
          // If already exists due to parallel race
          logger.debug(`[Inventory Scan] Duplicate page or db error for ${url}: ${dbErr.message}`);
        }

        if (statusCode >= 400) return; // Skip asset extraction on error pages

        // Asset Extraction
        const imagesToInsert = [];
        const cssToInsert = [];
        const jsToInsert = [];
        const docsToInsert = [];
        const emailsToInsert = [];
        const headlinksToInsert = [];
        const formsToInsert = [];
        const iframesToInsert = [];
        const framesToInsert = [];

        // 1. Extract Images
        $('img').each((_, el) => {
          const src = $(el).attr('src');
          if (src) {
            const resolved = resolveUrl(src, url);
            if (resolved) {
              const alt = $(el).attr('alt') || '';
              const ext = resolved.split('?')[0].split('.').pop().toLowerCase() || 'png';
              imagesToInsert.push({
                scan_id: scanId,
                domain_id: domainId,
                page_url: url,
                image_url: resolved,
                alt_text: alt.slice(0, 500),
                image_type: ext,
                image_size: 'Unknown',
                status_code: 200
              });
            }
          }
        });

        // 2. Extract CSS
        $('link[rel="stylesheet"]').each((_, el) => {
          const href = $(el).attr('href');
          if (href) {
            const resolved = resolveUrl(href, url);
            if (resolved) {
              cssToInsert.push({
                scan_id: scanId,
                domain_id: domainId,
                page_url: url,
                css_url: resolved,
                status_code: 200
              });
            }
          }
        });

        // 3. Extract JS
        $('script[src]').each((_, el) => {
          const src = $(el).attr('src');
          if (src) {
            const resolved = resolveUrl(src, url);
            if (resolved) {
              jsToInsert.push({
                scan_id: scanId,
                domain_id: domainId,
                page_url: url,
                js_url: resolved,
                status_code: 200
              });
            }
          }
        });

        const linksToInsert = [];
        const seenLinksOnPage = new Set();

        // 4. Extract Documents and Internal Links to Crawl
        $('a').each((_, el) => {
          const href = $(el).attr('href');
          if (!href) return;
          const resolved = resolveUrl(href, url);
          if (!resolved) return;

          const ext = resolved.split('?')[0].split('.').pop().toLowerCase();
          const anchorText = $(el).text().trim() || '(Empty Anchor)';
          const linkType = isInternalUrl(resolved) ? 'internal' : 'external';

          // Extract standard internal/external links for asset inventory
          if (!DOCUMENT_EXTENSIONS.includes(ext) && !resolved.startsWith('mailto:') && !resolved.startsWith('tel:')) {
            if (!seenLinksOnPage.has(resolved)) {
              seenLinksOnPage.add(resolved);
              linksToInsert.push({
                scan_id: scanId,
                domain_id: domainId,
                page_url: url,
                link_url: resolved,
                link_type: linkType,
                status_code: 200,
                anchor_text: anchorText.slice(0, 300)
              });
            }
          }

          // Check if it is a document
          if (DOCUMENT_EXTENSIONS.includes(ext)) {
            docsToInsert.push({
              scan_id: scanId,
              domain_id: domainId,
              page_url: url,
              document_url: resolved,
              document_type: ext
            });
          }
          // Otherwise, if it is internal, queue it for crawl
          else if (isInternalUrl(resolved)) {
            const canon = canonicalPageUrl(resolved);
            if (canon && !visited.has(canon) && !queue.includes(canon) && !isUrlBlocked(canon)) {
              queue.push(canon);
            }
          }
        });

        // 5. Extract Emails
        const bodyText = $('body').text() || '';
        const emailMatches = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
        // Add mailto links
        $('a[href^="mailto:"]').each((_, el) => {
          const email = $(el).attr('href').replace(/^mailto:/i, '').split('?')[0].trim();
          if (email && email.includes('@')) {
            emailMatches.push(email);
          }
        });
        const uniqueEmails = [...new Set(emailMatches)];
        uniqueEmails.forEach(email => {
          emailsToInsert.push({
            scan_id: scanId,
            domain_id: domainId,
            page_url: url,
            email_address: email
          });
        });

        // 6. Extract Headlinks
        $('link').each((_, el) => {
          const rel = $(el).attr('rel');
          const href = $(el).attr('href');
          if (rel && href && ['canonical', 'preload', 'dns-prefetch', 'stylesheet', 'icon', 'alternate'].includes(rel.toLowerCase())) {
            const resolved = resolveUrl(href, url);
            if (resolved) {
              headlinksToInsert.push({
                scan_id: scanId,
                domain_id: domainId,
                page_url: url,
                rel_type: rel.toLowerCase(),
                href: resolved
              });
            }
          }
        });

        // 7. Extract Forms
        $('form').each((_, el) => {
          const action = $(el).attr('action') || '';
          const resolvedAction = action ? resolveUrl(action, url) : url;
          const method = ($(el).attr('method') || 'GET').toUpperCase();
          const inputCount = $(el).find('input, select, textarea').length;
          formsToInsert.push({
            scan_id: scanId,
            domain_id: domainId,
            page_url: url,
            form_action: resolvedAction,
            form_method: method,
            input_count: inputCount
          });
        });

        // 8. Extract IFrames
        $('iframe').each((_, el) => {
          const src = $(el).attr('src') || '';
          const resolvedSrc = src ? resolveUrl(src, url) : '(No Source)';
          iframesToInsert.push({
            scan_id: scanId,
            domain_id: domainId,
            page_url: url,
            iframe_src: resolvedSrc
          });
        });

        // 9. Extract Frames
        $('frame').each((_, el) => {
          const src = $(el).attr('src') || '';
          const resolvedSrc = src ? resolveUrl(src, url) : '(No Source)';
          framesToInsert.push({
            scan_id: scanId,
            domain_id: domainId,
            page_url: url,
            frame_src: resolvedSrc
          });
        });

        // Database inserts with bulk writes to prevent duplicate unique key violations
        if (imagesToInsert.length > 0) {
          // Rapid parallel HEAD checks to resolve actual image sizes (limited to first 25 to protect bandwidth)
          try {
            await Promise.all(
              imagesToInsert.slice(0, 25).map(async (img) => {
                img.image_size = await fetchAssetSize(img.image_url);
              })
            );
          } catch (sizeErr) {
            // Graceful fallback
          }

          try {
            await PageImage.insertMany(imagesToInsert, { ordered: false });
            totalImagesCount += imagesToInsert.length;
          } catch (e) {
            totalImagesCount += (imagesToInsert.length - (e.writeErrors?.length || 0));
          }
        }

        if (cssToInsert.length > 0) {
          try {
            await PageCss.insertMany(cssToInsert, { ordered: false });
            totalCssCount += cssToInsert.length;
          } catch (e) {
            totalCssCount += (cssToInsert.length - (e.writeErrors?.length || 0));
          }
        }

        if (jsToInsert.length > 0) {
          try {
            await PageJs.insertMany(jsToInsert, { ordered: false });
            totalJsCount += jsToInsert.length;
          } catch (e) {
            totalJsCount += (jsToInsert.length - (e.writeErrors?.length || 0));
          }
        }

        if (docsToInsert.length > 0) {
          try {
            await PageDocument.insertMany(docsToInsert, { ordered: false });
            totalDocsCount += docsToInsert.length;
          } catch (e) {
            totalDocsCount += (docsToInsert.length - (e.writeErrors?.length || 0));
          }
        }

        if (emailsToInsert.length > 0) {
          try {
            await PageEmail.insertMany(emailsToInsert, { ordered: false });
            totalEmailsCount += emailsToInsert.length;
          } catch (e) {
            totalEmailsCount += (emailsToInsert.length - (e.writeErrors?.length || 0));
          }
        }

        if (headlinksToInsert.length > 0) {
          try {
            await PageHeadlink.insertMany(headlinksToInsert, { ordered: false });
            totalHeadlinksCount += headlinksToInsert.length;
          } catch (e) {
            totalHeadlinksCount += (headlinksToInsert.length - (e.writeErrors?.length || 0));
          }
        }

        if (linksToInsert.length > 0) {
          try {
            await PageLink.insertMany(linksToInsert, { ordered: false });
          } catch (e) {
            // Ignore compound index key collisions safely
          }
        }

        if (formsToInsert.length > 0) {
          try {
            await PageForm.insertMany(formsToInsert, { ordered: false });
          } catch (e) {
            // Ignore
          }
        }

        if (iframesToInsert.length > 0) {
          try {
            await PageIframe.insertMany(iframesToInsert, { ordered: false });
          } catch (e) {
            // Ignore
          }
        }

        if (framesToInsert.length > 0) {
          try {
            await PageFrame.insertMany(framesToInsert, { ordered: false });
          } catch (e) {
            // Ignore
          }
        }

        // Live progress update on DomainScanMaster record
        const progress = Math.min(99, Math.round((pagesCrawledCount / Math.min(pageLimit, visited.size || pageLimit)) * 100));
        await DomainScanMaster.findByIdAndUpdate(scanId, {
          total_pages: pagesCrawledCount,
          total_images: totalImagesCount,
          total_css: totalCssCount,
          total_js: totalJsCount,
          total_documents: totalDocsCount,
          total_emails: totalEmailsCount,
          total_headlinks: totalHeadlinksCount,
          progress_percent: progress
        });

        logger.info(`[Inventory Scan Progress] 📈 Scanned Page: ${url} | Progress: ${progress}%`);
        logger.info(`   └── 📦 Assets Discovered -> Pages: ${pagesCrawledCount} | Images: ${totalImagesCount} | CSS: ${totalCssCount} | JS: ${totalJsCount} | Docs: ${totalDocsCount} | Emails: ${totalEmailsCount} | Headlinks: ${totalHeadlinksCount}`);
      }));
    }

    // 7. Crawl finished successfully!
    const finalDurationMs = Date.now() - startTime;
    await DomainScanMaster.findByIdAndUpdate(scanId, {
      status: 'completed',
      progress_percent: 100,
      scan_completed_at: new Date(),
      duration_ms: finalDurationMs
    });

    logger.info(`[Inventory Scan Completed] ✅ Crawl finished successfully in ${finalDurationMs}ms!`);
    logger.info(`   └── 📊 Final Inventory Totals -> Pages: ${pagesCrawledCount} | Images: ${totalImagesCount} | CSS: ${totalCssCount} | JS: ${totalJsCount} | Docs: ${totalDocsCount} | Emails: ${totalEmailsCount} | Headlinks: ${totalHeadlinksCount}`);
    return { success: true, pagesScanned: pagesCrawledCount, durationMs: finalDurationMs };
  } catch (error) {
    logger.error(`[Inventory Scan] Error during scan job: ${error.stack}`);
    if (conn) {
      try {
        const DomainScanMaster = conn.model('DomainScanMaster', DomainScanMasterSchema);
        await DomainScanMaster.findByIdAndUpdate(scanId, {
          status: 'failed',
          error_message: error.message,
          scan_completed_at: new Date()
        });
      } catch (dbErr) {
        logger.error(`[Inventory Scan] Could not update scan status to failed: ${dbErr.message}`);
      }
    }
    throw error;
  }
};
