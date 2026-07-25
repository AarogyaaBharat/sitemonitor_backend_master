import puppeteer from 'puppeteer';
import axios from 'axios';
import { logger } from '../utils/logger.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/generate';
const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'llava'; // Requires llava to be pulled

/**
 * Scans a page for deceptive UI patterns using a Vision AI model (LLaVA).
 */
export const scanVisualDeception = async (url) => {
  let browser;
  try {
    // We only try to ping the model first to see if it's available and supports vision.
    try {
      const ping = await axios.post(OLLAMA_URL, { model: VISION_MODEL, prompt: "test", stream: false });
    } catch(e) {
      logger.warn(`[VisualScan] Vision model '${VISION_MODEL}' not responding or not installed. Skipping visual scan.`);
      return [];
    }

    browser = await puppeteer.launch({
      headless: "new",
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    logger.info(`[VisualScan] Navigating to ${url} and capturing screenshot...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Capture screenshot as base64
    const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 50, encoding: 'base64' });
    await browser.close();
    const prompt = `You are a UX and Dark Pattern detection expert. 
Analyze the provided screenshot of a webpage and identify ALL deceptive "Dark Patterns".
CRITICAL RULES:
1. Do NOT stop after finding just one issue. You MUST analyze the entire screenshot and return an array of ALL issues found.
2. Do NOT hallucinate or make up text or errors. ONLY report issues that are visibly present in the screenshot. Do not assume text exists if you cannot see it.

Look for:
- Interface Interference: Are there hidden "Cancel" or "Reject" buttons due to low contrast (e.g. light grey text on white background)?
- Disguised Advertisements & Bait and Switch: Are there fake "Play Video" buttons that are actually just images/ads?
- Fake Social Proof: Are there images or badges claiming "1000+ Reviews" or "5 Stars" without any actual clickable reviews or proof?
- Confirm Shaming: Are there guilt-tripping texts next to opt-out buttons?

If you find any, return a valid JSON array of objects with the keys: type, severity, description, suggestion.
If no dark patterns are visually apparent, return an empty array [].
Do NOT output any markdown, ONLY valid JSON.
[
  {
    "type": "Name of the pattern (e.g., Fake Social Proof or Bait and Switch)",
    "severity": "High, Medium, or Low",
    "description": "A HIGHLY DETAILED explanation of the visual trick. You MUST explicitly describe what the visual element looks like (e.g. 'There is a fake play button overlaying an image' or 'The image claims 1000+ reviews but is not clickable').",
    "suggestion": "A detailed, step-by-step actionable advice on how to fix the issue.",
    "legalRisk": "Potential FTC violation for deceptive UI."
  },
  {
    "type": "Another dark pattern (if applicable)",
    ...
  }
]`;

    const response = await axios.post(OLLAMA_URL, {
      model: VISION_MODEL,
      prompt: prompt,
      images: [screenshotBuffer],
      stream: false,
      format: "json",
      options: { temperature: 0.1 }
    });

    if (response.data && response.data.response) {
      let rawResponse = response.data.response.trim();
      logger.info(`\n[OLLAMA VISION RESPONSE for ${url}]:\n${rawResponse}\n`);
      try {
        let parsed = JSON.parse(rawResponse);
        if (!Array.isArray(parsed)) {
          parsed = parsed.type ? [parsed] : (parsed.patterns || []);
        }
        return parsed.map(issue => ({
          ...issue,
          screenshotBase64: screenshotBuffer // Save thumbnail
        }));
      } catch (jsonErr) {
        return [];
      }
    }
    return [];
  } catch (error) {
    logger.error(`[VisualScan] Error scanning ${url}: ${error.message}`);
    if (browser) await browser.close();
    return [];
  }
};
