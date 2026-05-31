import { logger } from '../utils/logger.js';

export class PolicyEvaluator {
  /**
   * Helper to perform numeric comparisons based on frontend logic.
   */
  static compareNumeric(actual, expected, comparison) {
    const a = parseFloat(actual);
    const e = parseFloat(expected);
    if (isNaN(a) || isNaN(e)) return false;

    switch (comparison?.toLowerCase()?.replace(/\s+/g, '-')) {
      case 'less-than':
        return a < e;
      case 'less-than-or-equal':
        return a <= e;
      case 'greater-than':
        return a > e;
      case 'greater-than-or-equal':
        return a >= e;
      case 'equal':
        return a === e;
      default:
        // Handle "Greater than" with spaces too
        const norm = comparison?.toLowerCase();
        if (norm === 'greater than') return a > e;
        if (norm === 'greater than or equal') return a >= e;
        if (norm === 'less than') return a < e;
        if (norm === 'less than or equal') return a <= e;
        return false;
    }
  }

  /**
   * Helper for text comparison logic.
   */
  static textMatch(content, searchVal, type) {
    const c = (content || '').toLowerCase();
    const s = (searchVal || '').toLowerCase();
    switch (type) {
      case 'contains': 
        return c.includes(s);
      case 'equals': 
        return c.trim() === s.trim();
      case 'starts-with': 
        return c.trim().startsWith(s.trim());
      case 'ends-with': 
        return c.trim().endsWith(s.trim());
      case 'regex':
        try {
          const regex = new RegExp(searchVal, 'gi');
          return regex.test(content);
        } catch { return false; }
      default: 
        return c.includes(s);
    }
  }

  /**
   * Helper for counting text matches in content.
   */
  static countTextMatches(content, searchVal, type) {
    if (!content || !searchVal) return 0;
    const c = content.toLowerCase();
    const s = searchVal.toLowerCase();
    
    switch (type) {
      case 'contains':
        return c.split(s).length - 1;
      case 'regex':
        try {
          const regex = new RegExp(searchVal, 'gi');
          const matches = content.match(regex);
          return matches ? matches.length : 0;
        } catch { return 0; }
      default:
        return this.textMatch(content, searchVal, type) ? 1 : 0;
    }
  }

  /**
   * Normalizes search types from frontend to internal logic.
   */
  static normalizeSearchType(type) {
    if (!type) return 'contains';
    const t = type.toLowerCase();
    if (t.includes('starts')) return 'starts-with';
    if (t.includes('ends')) return 'ends-with';
    if (t.includes('equal')) return 'equals';
    if (t.includes('regex')) return 'regex';
    return 'contains'; // Default for "Contains", "Contains Words", etc.
  }

  /**
   * Evaluates a single rule against page data.
   */
  static evaluateRule(rule, pageData) {
    const { type, searchType, searchValue, containing, comparison, characterCount, value: ruleValue, unit } = rule;
    const expectedValue = characterCount || ruleValue || 0;
    const normalizedSearch = this.normalizeSearchType(searchType);
    const searchVal = (searchValue || '').toLowerCase();

    // Helper for evaluating items in an array (links, images, headings)
    const evaluateArray = (items, getValFunc, isNumeric = false) => {
      if (!items || !Array.isArray(items)) return { isMatch: false, matchCount: 0, totalCount: 0 };
      let count = 0;
      items.forEach(item => {
        const val = getValFunc(item);
        if (isNumeric) {
          let target = expectedValue;
          if (type === 'image-size' || type === 'file-size') {
            if (unit === 'KB') target *= 1024;
            else if (unit === 'MB') target *= 1024 * 1024;
          }
          if (this.compareNumeric(val, target, comparison)) count++;
        } else {
          if (this.textMatch(val, searchVal, normalizedSearch)) count++;
        }
      });
      return { isMatch: count > 0, matchCount: count, totalCount: items.length };
    };

    // --- 1. Rule Evaluation Logic ---
    let result = { isMatch: false, matchCount: 0, totalCount: 1 };

    switch (type) {
      // Numeric/Length (Single Value)
      case 'page-title-length':
        result.matchCount = (pageData.meta?.title || '').length;
        result.isMatch = this.compareNumeric(result.matchCount, expectedValue, comparison);
        result.matchCount = result.isMatch ? 1 : 0;
        break;

      case 'file-size':
        let size = pageData.performance?.pageSizeKB || 0;
        if (unit === 'Bytes') size *= 1024;
        if (unit === 'MB') size /= 1024;
        result.isMatch = this.compareNumeric(size, expectedValue, comparison);
        result.matchCount = result.isMatch ? 1 : 0;
        break;

      case 'external-link-count':
        result.matchCount = pageData.links?.external || 0;
        result.isMatch = this.compareNumeric(result.matchCount, expectedValue, comparison);
        result.matchCount = result.isMatch ? 1 : 0;
        break;

      case 'incoming-link-count':
        result.matchCount = pageData.links?.internal || 0;
        result.isMatch = this.compareNumeric(result.matchCount, expectedValue, comparison);
        result.matchCount = result.isMatch ? 1 : 0;
        break;

      case 'meta-header-length':
        result.matchCount = (pageData.meta?.description || '').length;
        result.isMatch = this.compareNumeric(result.matchCount, expectedValue, comparison);
        result.matchCount = result.isMatch ? 1 : 0;
        break;

      // Numeric (Array Based)
      case 'image-size':
        result = evaluateArray(pageData.imageAnalysis?.imageLoadDetails, img => img.sizeBytes || 0, true);
        break;

      case 'link-text-length':
        result = evaluateArray(pageData.links?.linkDetails, link => (link.anchorText || '').length, true);
        break;

      case 'image-text-length':
        result = evaluateArray(pageData.imageAnalysis?.imageLoadDetails, img => (img.alt || '').length, true);
        break;

      case 'header-text-length':
        result = evaluateArray(pageData.headings?.headingDetails, h => h.length, true);
        break;

      // Content (Single Value)
      case 'page-title':
        result.isMatch = this.textMatch(pageData.meta?.title, searchVal, normalizedSearch);
        result.matchCount = result.isMatch ? this.countTextMatches(pageData.meta?.title, searchVal, normalizedSearch) : 0;
        break;

      case 'meta-description':
        result.isMatch = this.textMatch(pageData.meta?.description, searchVal, normalizedSearch);
        result.matchCount = result.isMatch ? this.countTextMatches(pageData.meta?.description, searchVal, normalizedSearch) : 0;
        break;

      case 'meta-header':
        const metaTarget = (rule.metaName || '').toLowerCase();
        const metaSearchType = this.normalizeSearchType(rule.exprType || searchType);
        const metaSearchVal = (rule.exprValue || searchValue || '').toLowerCase();
        
        const relevantMeta = (pageData.meta?.allMeta || []).filter(m => (m.name || '').toLowerCase() === metaTarget);
        result = evaluateArray(relevantMeta, m => m.content, false);
        // Map back to expected properties if needed
        if (relevantMeta.length === 0 && !metaTarget) {
            // Fallback to description if no specific meta name provided
            result.isMatch = this.textMatch(pageData.meta?.description, metaSearchVal, metaSearchType);
            result.matchCount = result.isMatch ? 1 : 0;
        }
        break;

      case 'text':
        result.isMatch = this.textMatch(pageData.bodyText, searchVal, normalizedSearch);
        result.matchCount = result.isMatch ? this.countTextMatches(pageData.bodyText, searchVal, normalizedSearch) : 0;
        break;

      case 'page-html':
        result.isMatch = this.textMatch(pageData.html, searchVal, normalizedSearch);
        result.matchCount = result.isMatch ? this.countTextMatches(pageData.html, searchVal, normalizedSearch) : 0;
        break;

      case 'page-url':
        result.isMatch = this.textMatch(pageData.url, searchVal, normalizedSearch);
        result.matchCount = result.isMatch ? 1 : 0;
        break;

      // Content (Array Based)
      case 'heading-text':
        result = evaluateArray(pageData.headings?.headingDetails, h => h);
        break;

      case 'link-text':
        result = evaluateArray(pageData.links?.linkDetails, link => link.anchorText);
        break;

      case 'link':
        result = evaluateArray(pageData.links?.linkDetails, link => link.url);
        break;

      case 'image-text':
        result = evaluateArray(pageData.imageAnalysis?.imageLoadDetails, img => img.alt);
        break;

      case 'readability-level':
        const gradeMapping = {
          "Below 5th grade": 4,
          "5th grade": 5,
          "6th grade": 6,
          "7th grade": 7,
          "8th to 9th grade": 9,
          "10th to 12th grade": 12,
          "College": 16
        };
        const actualGrade = pageData.textMetrics?.readabilityScore || 0;
        const targetGrade = gradeMapping[rule.readabilityScore] || parseFloat(rule.readabilityScore) || 0;
        result.isMatch = this.compareNumeric(actualGrade, targetGrade, rule.searchFor || comparison);
        result.matchCount = result.isMatch ? 1 : 0;
        break;

      default:
        // Default to body text search
        result.isMatch = this.textMatch(pageData.bodyText, searchVal, normalizedSearch);
        result.matchCount = result.isMatch ? this.countTextMatches(pageData.bodyText, searchVal, normalizedSearch) : 0;
    }

    // --- 2. Post-Process (Containing/Not Containing) ---
    if (containing === 'not-containing') {
      return { 
        isMatch: !result.isMatch, 
        matchCount: result.isMatch ? 0 : 1, 
        totalCount: result.totalCount 
      };
    }

    return result;
  }

  /**
   * Evaluates a policy against page data.
   */
  static evaluatePolicy(policy, pageData) {
    const { rules, ruleOperator = 'or' } = policy;
    if (!rules || rules.length === 0) return { isMatch: false, matchedRules: [] };

    const evaluationResults = rules.map(rule => {
      const { isMatch, matchCount, totalCount } = this.evaluateRule(rule, pageData);
      return {
        ruleId: rule.id || rule._id,
        ruleName: rule.ruleName,
        isMatch,
        matchCount,
        totalCount
      };
    });
    
    const matchedRules = evaluationResults.filter(r => r.isMatch);
    const totalMatchCount = matchedRules.reduce((sum, r) => sum + (r.matchCount || 0), 0);
    const totalItemsCount = evaluationResults.reduce((sum, r) => sum + (r.totalCount || 0), 0);
    let isMatch = false;

    if (ruleOperator.toLowerCase() === 'and') {
      isMatch = evaluationResults.every(r => r.isMatch);
    } else {
      isMatch = evaluationResults.some(r => r.isMatch);
    }

    return { isMatch, matchedRules, evaluationResults, totalMatchCount, totalItemsCount };
  }

  /**
   * Processes policies for a page and determines if it's a "hit".
   */
  static processPolicies(policies, pageData) {
    return policies.map(policy => {
      const { isMatch, matchedRules, evaluationResults, totalMatchCount, totalItemsCount } = this.evaluatePolicy(policy, pageData);
      
      let isHit = false;
      if (policy.category === 'unwanted') {
        isHit = isMatch;
      } else if (policy.category === 'required') {
        isHit = !isMatch;
      } else {
        isHit = isMatch;
      }

      return {
        policyId: policy._id,
        title: policy.title,
        category: policy.category,
        priority: policy.priority,
        isMatch,
        isHit,
        matchCount: totalMatchCount,
        totalCount: totalItemsCount,
        matchedRules,
        evaluationResults
      };
    });
  }
}
