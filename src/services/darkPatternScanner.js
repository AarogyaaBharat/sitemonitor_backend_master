import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';

/**
 * Strips raw HTML down to its readable text and structural components (buttons, links, forms)
 * to reduce the token count sent to the LLM.
 */
const extractRelevantContent = (html) => {
  if (!html) return '';
  try {
    const $ = cheerio.load(html);
    // Remove scripts, styles, svgs, hidden elements
    $('script, style, svg, path, noscript, meta, link, [style*="display: none"], [hidden]').remove();

    let content = '';

    // Extract Modals/Popups explicitly
    $('[class*="modal"], [class*="popup"], [class*="dialog"], dialog').each((i, el) => {
      content += `\n[MODAL/POPUP START]\n`;
      $(el).find('*').each((j, child) => {
        if (child.type === 'text') {
          const text = $(child).text().trim();
          if (text) content += text + ' ';
        } else if (child.tagName === 'a') {
          content += `[LINK: ${$(child).text().trim()}] `;
        } else if (child.tagName === 'button') {
          content += `[BUTTON: ${$(child).text().trim()}] `;
        }
      });
      content += `\n[MODAL/POPUP END]\n`;
      // Remove it so it doesn't get extracted twice
      $(el).remove();
    });

    // Extract Forms explicitly
    $('form').each((i, el) => {
      content += `\n[FORM START]\n`;
      $(el).find('*').each((j, child) => {
        if (child.type === 'text') {
          const text = $(child).text().trim();
          if (text) content += text + ' ';
        } else if (child.tagName === 'a') {
          content += `[LINK: ${$(child).text().trim()}] `;
        } else if (child.tagName === 'button') {
          content += `[BUTTON: ${$(child).text().trim()}] `;
        } else if (child.tagName === 'input' && child.attribs.type !== 'hidden') {
          content += `[INPUT: ${child.attribs.placeholder || child.attribs.name || ''}] `;
        }
      });
      content += `\n[FORM END]\n`;
      // Remove it so it doesn't get extracted twice
      $(el).remove();
    });

    // We want to keep text, but also structure like buttons or links which are notorious for dark patterns
    $('body').find('*').each((i, el) => {
      if (el.type === 'text') {
        const text = $(el).text().trim();
        if (text) content += text + ' ';
      } else if (el.tagName === 'a') {
        content += `[LINK: ${$(el).text().trim()}] `;
      } else if (el.tagName === 'button') {
        content += `[BUTTON: ${$(el).text().trim()}] `;
      } else if (el.tagName === 'input' && el.attribs.type !== 'hidden') {
        content += `[INPUT: ${el.attribs.placeholder || el.attribs.name || ''}] `;
      } else if (el.tagName === 'img') {
        content += `[IMAGE: ${el.attribs.alt || el.attribs.title || 'Graphic content'}] `;
      } else if (el.tagName === 'iframe') {
        content += `[IFRAME/VIDEO EMBED: ${el.attribs.src || el.attribs.title || 'Embedded content'}] `;
      }
    });

    return content.replace(/\s+/g, ' ').substring(0, 15000); // Limit to ~15k chars to fit typical context window
  } catch (error) {
    logger.warn(`darkPatternScanner: Cheerio extraction failed - ${error.message}`);
    // Fallback: simple regex strip
    return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .substring(0, 15000);
  }
};

/**
 * Scans a single page for dark patterns using Ollama
 * @param {string} html - Raw HTML of the page
 * @param {string} url - URL of the page (for context)
 * @returns {Promise<Array>} - Array of dark pattern issue objects
 */
export const scanPageForDarkPatterns = async (html, url) => {
  const content = extractRelevantContent(html);

  if (!content || content.length < 50) {
    return []; // Too little content to analyze
  }

  const prompt = `
You are a UX and Dark Pattern detection expert. 
Analyze the following webpage content (provided as extracted text and UI elements) and identify ALL deceptive "Dark Patterns" present on the page. 
CRITICAL RULES:
1. Do NOT stop after finding just one issue. You MUST analyze the entire content and return an array of ALL issues found.
2. Do NOT hallucinate or make up text or errors. ONLY report issues based on the EXACT text and elements provided below. If a warning or message is not in the text, do not assume it exists.
3. Look for Fake Data or Contradictions: E.g., an [IMAGE: 1000+ Reviews] but no actual reviews are present in the text, or a [LINK] or [IFRAME] that looks like a video but isn't.
4. Pay special attention to [MODAL/POPUP START] and [FORM START] blocks. 
   - Check Popup buttons/text for "Confirm Shaming" (e.g., guilt-tripping "No thanks, I hate saving money").
   - Check Form [BUTTON] and [INPUT] elements for "Trick Questions" or "Forced Action".

You MUST categorize any found issues strictly into one of these 14 recognized dark patterns: 
1. False Urgency, 2. Basket Sneaking, 3. Confirm Shaming, 4. Forced Action, 5. Subscription Trap, 6. Interface Interference, 7. Bait and Switch, 8. Drip Pricing, 9. Disguised Advertisement, 10. Nagging, 11. Trick Question, 12. SaaS Billing, 13. Rogue Malwares, 14. Fake Social Proof.

Page URL: ${url}

Webpage Content:
---
${content}
---

Your response MUST be a valid JSON array containing objects with the following keys. If no dark patterns are found, return an empty array [].
Do NOT output any markdown, markdown code blocks, or explanatory text. ONLY valid JSON.
[
  {
    "type": "Name of the dark pattern",
    "severity": "High, Medium, or Low",
    "description": "A HIGHLY DETAILED explanation of the issue. You MUST quote the EXACT text or element found in the content above. Explain exactly why this specific text or element is deceptive. If it is in a popup or form, explicitly state that.",
    "suggestion": "A detailed, step-by-step actionable advice on how to fix the issue and improve transparency.",
    "legalRisk": "Briefly state any potential compliance/legal risks."
  },
  {
    "type": "Another dark pattern (if applicable)",
    ...
  }
]
  `;
  try {
    const response = await axios.post(OLLAMA_URL, {
      model: OLLAMA_MODEL,
      prompt: prompt,
      stream: false,
      format: "json",
      options: {
        temperature: 0.1, // Low temperature for more deterministic JSON output
        top_p: 0.9
      }
    });

    if (response.data && response.data.response) {
      let rawResponse = response.data.response.trim();

      // Log the raw response so we can see what Ollama generated in the terminal
      logger.info(`\n[OLLAMA DARK PATTERN RESPONSE for ${url}]:\n${rawResponse}\n`);

      // Attempt to parse JSON safely
      try {
        let parsed = JSON.parse(rawResponse);

        if (!Array.isArray(parsed)) {
          if (parsed && typeof parsed === 'object' && parsed.type) {
            parsed = [parsed];
          } else if (parsed && parsed.patterns && Array.isArray(parsed.patterns)) {
            parsed = parsed.patterns;
          } else if (parsed && parsed.darkPatterns && Array.isArray(parsed.darkPatterns)) {
            parsed = parsed.darkPatterns;
          } else {
            parsed = [];
          }
        }

        return parsed;
      } catch (jsonErr) {
        logger.error(`darkPatternScanner: Failed to parse Ollama JSON response for ${url}. Raw: ${rawResponse.substring(0, 200)}...`);
        return [];
      }
    }

    return [];
  } catch (error) {
    logger.error(`darkPatternScanner: Ollama request failed for ${url}: ${error.message}`);
    // Return empty array so the scan doesn't crash the entire job queue if Ollama is down
    return [];
  }
};
