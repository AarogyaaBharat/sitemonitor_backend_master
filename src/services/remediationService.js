import axios from 'axios';
import { logger } from '../utils/logger.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';

export const generateRemediationCode = async (issueType, issueDescription, issueSuggestion) => {
  try {
    const prompt = 'You are a Senior Frontend Engineer. Your task is to write the exact HTML or React code required to fix a specific Dark Pattern UI issue.\n' +
      'Issue Type: ' + issueType + '\n' +
      'Description of the deceptive element: ' + issueDescription + '\n' +
      'Recommended Fix: ' + issueSuggestion + '\n\n' +
      'Please generate the corrected, fully accessible, and ethical code for this UI component.\n' +
      'Return ONLY the raw code block. Do NOT return any markdown wrapping. Do not add any conversational text. Return just the raw text of the code.';

    const response = await axios.post(OLLAMA_URL, {
      model: OLLAMA_MODEL,
      prompt: prompt,
      stream: false,
      options: {
        temperature: 0.2
      }
    });

    if (response.data && response.data.response) {
      let code = response.data.response.trim();
      return code;
    }
    return 'Error: Could not generate code.';
  } catch (error) {
    logger.error('[Remediation] Failed to generate code: ' + error.message);
    throw new Error('Failed to reach AI for code generation.');
  }
};
