import mongoose from 'mongoose';

export const DomainReportSchema = new mongoose.Schema({
  domain: { type: String, required: true, index: true },
  url: { type: String, required: true },
  httpStatus: { type: Number },
  scanDate: { type: Date, default: Date.now, index: -1 },
  performance: {
    pageLoadTime: Number,
    timeToFirstByte: Number,
    pageSizeKB: Number,
    numberOfScripts: Number,
    numberOfCssFiles: Number,
    redirects: [String],
    coreWebVitals: {
      LCP: Number,
      FID: Number,
      CLS: Number,
      TBT: Number,
      FCP: Number,
      SpeedIndex: Number,
      INP: Number
    },
    renderBlockingResources: [String],
    advancedMetrics: {
      performanceScore: Number,
      domContentLoadedTime: Number,
      fullyLoadedTime: Number,
      totalPageLoadTime: Number
    }
  },
  networkMetrics: {
    totalRequests: Number,
    totalTransferredSize: String,
    jsSize: String,
    cssSize: String,
    imageSize: String,
    resourceCount: {
      js: Number,
      css: Number,
      image: Number,
      font: Number,
      xhr: Number
    }
  },
  resources: [{
    url: String,
    type: { type: String },
    status: Number,
    startTime: Number,
    endTime: Number,
    loadDuration: String,
    size: String
  }],
  imageAnalysis: {
    total: Number,
    withAlt: Number,
    withoutAlt: Number,
    totalSize: String,
    imageLoadDetails: [{
      url: String,
      size: String,
      loadTime: String,
      lazy: Boolean,
      naturalSize: String
    }]
  },
  loadingSummary: {
    totalLoadTime: String,
    avgResourceLoadTime: String,
    slowestResource: {
      url: String,
      loadTime: String
    },
    largestResource: {
      url: String,
      size: String
    }
  },
  headings: { h1: Number, h2: Number, h3: Number, h4: Number, h5: Number, h6: Number, paragraphs: Number, lists: { ul: Number, ol: Number } },
  textMetrics: { wordCount: Number, keywordDensity: mongoose.Schema.Types.Mixed, textToHtmlRatio: Number, duplicateContent: Boolean, spellingMistakesCount: Number, spellingMistakesKeywords: [String], spellingCorrections: [mongoose.Schema.Types.Mixed], writingHints: [mongoose.Schema.Types.Mixed] },
  links: { internal: Number, external: Number, internalUrls: [String], outboundUrls: [String], outboundLinksDetailed: [mongoose.Schema.Types.Mixed], brokenLinkSampleSize: Number, brokenLinkCandidatesTotal: Number, broken: Number, brokenAnchors: Number, brokenDetails: [String], unwanted: [String], outboundLinksQuality: String, inboundBacklinksNote: String },
  images: { total: Number, withoutAlt: Number, missingAltDetails: [mongoose.Schema.Types.Mixed], lazyLoaded: Number, loadingTimes: [Number], altTextQuality: String },
  files: { 
    js: [mongoose.Schema.Types.Mixed], 
    css: [mongoose.Schema.Types.Mixed],
    others: [mongoose.Schema.Types.Mixed]
  },
  meta: { title: String, description: String, robots: String, canonical: String, hreflang: [String], openGraph: mongoose.Schema.Types.Mixed, twitterCard: mongoose.Schema.Types.Mixed },
  accessibility: { ariaRoles: [String], colorContrastIssues: Number, mobileResponsive: Boolean, keyboardNavigation: Boolean },
  policies: mongoose.Schema.Types.Mixed,
  cssAnalysis: {
    internalCssSize: Number,
    internalCssCount: Number,
    inlineCssCount: Number,
    totalCssImpact: String,
    recommendation: String
  },
  jsAnalysis: {
    internalJsSize: Number,
    internalJsCount: Number,
    totalJsImpact: String,
    recommendation: String
  },
  security: { sslValid: Boolean, sslExpiryDate: Date, mixedContent: Boolean },
  additionalChecks: {
    structuredDataErrors: Number,
    robotsTxtPresent: Boolean,
    sitemapXmlPresent: Boolean,
    canonicalConflicts: Boolean,
    hasCustom404: Boolean,
    formDetails: [mongoose.Schema.Types.Mixed],
    iframeDetails: [mongoose.Schema.Types.Mixed],
    frameDetails: [mongoose.Schema.Types.Mixed],
    headLinks: [mongoose.Schema.Types.Mixed]
  },
  lighthouseSeoScore: Number, seoScore: Number, seoScoreOutOf: { type: Number, default: 100 }, googleRankingNote: String, seoReportBasis: mongoose.Schema.Types.Mixed, improvementPoints: mongoose.Schema.Types.Mixed, seoImprovements: [mongoose.Schema.Types.Mixed],
  jobId: { type: String, index: true }, sourceDomainDocId: { type: mongoose.Schema.Types.ObjectId, ref: 'Domain', index: true }, scanCompletedAt: { type: Date }, scanDurationMs: { type: Number }, status: { type: String, enum: ['success', 'failed'], index: true }
}, { timestamps: true, collection: 'domain_reports' });

DomainReportSchema.index({ domain: 1, url: 1, scanDate: -1 });
export const DomainReport = mongoose.model('DomainReport', DomainReportSchema, 'domain_reports');

