import puppeteer from 'puppeteer';
import { logger } from '../utils/logger.js';

export const scanPrivacyBanner = async (url) => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    logger.info(`[PrivacyScan] Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    const bannerAnalysis = await page.evaluate(() => {
      const getButtonScore = (text) => {
        const t = text.toLowerCase().trim();
        if (t.includes('accept all') || t === 'accept' || t === 'allow all' || t === 'i agree' || t === 'got it' || t === 'ok') return 'accept';
        if (t.includes('reject all') || t === 'reject' || t === 'decline' || t === 'no thanks' || t === 'disallow') return 'reject';
        if (t.includes('manage') || t.includes('preferences') || t.includes('settings') || t.includes('customize')) return 'manage';
        return 'unknown';
      };

      const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      let acceptBtn = null;
      let rejectBtn = null;
      let manageBtn = null;

      buttons.forEach(btn => {
        const text = btn.innerText || btn.textContent || '';
        const score = getButtonScore(text);
        const style = window.getComputedStyle(btn);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

        if (score === 'accept' && !acceptBtn) acceptBtn = { el: btn, text, isLink: btn.tagName === 'A' };
        if (score === 'reject' && !rejectBtn) rejectBtn = { el: btn, text, isLink: btn.tagName === 'A' };
        if (score === 'manage' && !manageBtn) manageBtn = { el: btn, text, isLink: btn.tagName === 'A' };
      });

      const issues = [];
      if (acceptBtn && !rejectBtn && manageBtn) {
        issues.push({
          type: "Privacy Zuckering",
          severity: "High",
          description: "Cookie banner provides an easy 'Accept All' button but hides the 'Reject All' option behind a 'Manage Preferences' menu.",
          suggestion: "Add a 'Reject All' button on the first layer of the cookie banner, identical in prominence to the 'Accept All' button.",
          legalRisk: "High risk of violating GDPR (Art. 7) and ePrivacy Directive which require rejecting cookies to be as easy as accepting them."
        });
      }
      if (acceptBtn && rejectBtn) {
        if (!acceptBtn.isLink && rejectBtn.isLink) {
          issues.push({
            type: "Interface Interference",
            severity: "Medium",
            description: "The 'Reject' option is formatted as a less visible text link, while the 'Accept' option is a prominent button.",
            suggestion: "Make the 'Reject' button visually equivalent to the 'Accept' button.",
            legalRisk: "Violates GDPR 'freely given consent' principles by using deceptive design to nudge users into accepting."
          });
        }
      }
      return issues;
    });

    await browser.close();
    return bannerAnalysis || [];
  } catch (error) {
    logger.error(`[PrivacyScan] Error scanning ${url}: ${error.message}`);
    if (browser) await browser.close();
    return [];
  }
};
