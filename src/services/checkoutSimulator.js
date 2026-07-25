import puppeteer from 'puppeteer';
import { logger } from '../utils/logger.js';

/**
 * Simulates a basic e-commerce checkout flow to detect Basket Sneaking and Drip Pricing.
 */
export const simulateCheckoutFlow = async (url) => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    logger.info(`[CheckoutSim] Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    const issues = [];
    
    // Attempt to find an "Add to Cart" button
    const cartButtonFound = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a'));
      for (const b of btns) {
        const text = (b.innerText || '').toLowerCase();
        if (text.includes('add to cart') || text.includes('buy now') || text === 'add') {
          b.click();
          return true;
        }
      }
      return false;
    });

    if (!cartButtonFound) {
      await browser.close();
      return []; // Not an e-commerce site or couldn't find button
    }

    // Wait a bit for cart to update
    await new Promise(r => setTimeout(r, 3000));

    // Try to go to cart or checkout
    const currentUrl = page.url();
    const cartUrls = [currentUrl + '/cart', currentUrl + '/checkout', currentUrl.replace(/\/$/, '') + '/cart'];
    
    let navigated = false;
    for (const cUrl of cartUrls) {
      try {
        await page.goto(cUrl, { waitUntil: 'networkidle2', timeout: 10000 });
        navigated = true;
        break;
      } catch (e) { /* ignore */ }
    }

    if (navigated) {
      // Analyze cart for sneak items or drip pricing
      const cartAnalysis = await page.evaluate(() => {
        const text = document.body.innerText.toLowerCase();
        const flags = [];
        
        // Very basic heuristic for Basket Sneaking (e.g. unexpected insurance or fast shipping auto-ticked)
        if (text.includes('shipping protection') || text.includes('extended warranty') || text.includes('insurance added')) {
          flags.push({
            type: "Basket Sneaking",
            severity: "High",
            description: "An unexpected item (e.g., shipping protection or warranty) appears to have been automatically added to the cart.",
            suggestion: "Ensure that optional items require explicit user opt-in (un-ticked checkboxes) before adding to the cart.",
            legalRisk: "Violates the EU Consumer Rights Directive (Article 22) which prohibits default pre-ticked boxes for extra payments."
          });
        }
        
        // Basic heuristic for Drip Pricing
        if (text.includes('service fee') || text.includes('convenience fee') || text.includes('processing fee')) {
          flags.push({
            type: "Drip Pricing",
            severity: "Medium",
            description: "Hidden fees (like service or convenience fees) appear only at the final checkout step.",
            suggestion: "Include all mandatory fees in the initial advertised price of the product.",
            legalRisk: "High risk of violating FTC guidelines against 'junk fees' and deceptive pricing."
          });
        }

        return flags;
      });
      issues.push(...cartAnalysis);
    }

    await browser.close();
    return issues;
  } catch (error) {
    logger.error(`[CheckoutSim] Error scanning ${url}: ${error.message}`);
    if (browser) await browser.close();
    return [];
  }
};
