import mongoose from 'mongoose';

export const AuditSchema = new mongoose.Schema(
  {
    domain: { type: String, required: true, index: true },
    jobId: { type: String, required: true, index: true },
    scanDate: { type: Date, default: Date.now, index: -1 },
    
    // Performance Metrics
    performance: {
      score: { type: Number, default: 0 },
      avgLCP: { type: Number, default: 0 },
      avgINP: { type: Number, default: 0 },
      status: { type: String, default: "Poor" }
    },

    // Domain Scan Coverage
    pagesAnalyzed: {
      totalPages: { type: Number, default: 0 },
      statusCodes: {
        200: { type: Number, default: 0 },
        301: { type: Number, default: 0 },
        302: { type: Number, default: 0 },
        404: { type: Number, default: 0 },
        500: { type: Number, default: 0 },
      },
      validUrls: { type: Number, default: 0 },
    },

    // SEO Health issue counts
    seoHealth: {
      'meta-title-missing': { type: Number, default: 0 },
      'meta-description-missing': { type: Number, default: 0 },
      'h1-tags-missing': { type: Number, default: 0 },
      'no-canonical': { type: Number, default: 0 },
      'multiple-h1-tags': { type: Number, default: 0 },
      'meta-description-too-long': { type: Number, default: 0 },
      'meta-description-too-short': { type: Number, default: 0 },
      'missing-alt-text': { type: Number, default: 0 },
    },

    // Response Status counts
    responseStatus: {
      validUrls: { type: Number, default: 0 },
      200: { type: Number, default: 0 },
      301: { type: Number, default: 0 },
      302: { type: Number, default: 0 },
      404: { type: Number, default: 0 },
      500: { type: Number, default: 0 },
    },

    // Spelling & Content quality counts
    spellChecker: {
      totalMisspellings: { type: Number, default: 0 },
      totalBrokenLinks: { type: Number, default: 0 },
      pagesWithMisspellings: { type: Number, default: 0 },
      pagesWithBrokenLinks: { type: Number, default: 0 },
      'title-meta-spelling': { type: Number, default: 0 },
      'headings-spelling': { type: Number, default: 0 },
      'image-alt-spelling': { type: Number, default: 0 },
      'anchor-cta-spelling': { type: Number, default: 0 },
      'navigation-footer-spelling': { type: Number, default: 0 },
      'form-labels-placeholders': { type: Number, default: 0 },
      'language-consistency': { type: Number, default: 0 },
      'accessibility-text-spelling': { type: Number, default: 0 },
      'content-spelling': { type: Number, default: 0 },
    },

    // Page-level details
    pages: [
      {
        url: { type: String, required: true },
        httpStatus: { type: Number, default: 200 },
        seoScore: { type: Number, default: 0 },
        performanceScore: { type: Number, default: 0 },
        accessibilityScore: { type: Number, default: 0 },
        lastCrawled: { type: Date },
        
        hasTitle: { type: Boolean, default: true },
        hasDescription: { type: Boolean, default: true },
        h1Count: { type: Number, default: 0 },
        hasCanonical: { type: Boolean, default: true },
        imagesWithoutAlt: { type: Number, default: 0 },
        
        misspellingsCount: { type: Number, default: 0 },
        brokenLinksCount: { type: Number, default: 0 },
      }
    ]
  },
  { timestamps: true, collection: "domain_audits" }
);

AuditSchema.index({ domain: 1, scanDate: -1 });

export const Audit = mongoose.model('Audit', AuditSchema, 'domain_audits');
