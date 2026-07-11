import { google } from "googleapis";
import { logger } from "../utils/logger.js";
import dotenv from "dotenv";

dotenv.config();

/**
 * Fetches Google Search Console data for a given domain.
 * @param {string} domainUrl - The domain URL (e.g., 'https://example.com')
 * @param {Object} tokens - User OAuth tokens { access_token, refresh_token }
 * @returns {Promise<Object>} GSC performance report data
 */
export const fetchGscData = async (domainUrl, tokens) => {
  if (!tokens || !tokens.refresh_token) {
    throw new Error(`No valid Google connection found for user`);
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GSC_CLIENT_ID,
      process.env.GSC_CLIENT_SECRET,
      process.env.GSC_REDIRECT_URI
    );
    oauth2Client.setCredentials({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token
    });

    // Auto-refresh token if expired
    const { token: newAccessToken } = await oauth2Client.getAccessToken();
    if (newAccessToken && newAccessToken !== tokens.access_token) {
      logger.info(`🔄 [GSC Service] Access token refreshed successfully for ${domainUrl}`);
      // Note: We don't save refreshed access token to DB here because the master service
      // shouldn't write to master user credentials directly, and refresh token is enough.
    }

    const searchconsole = google.webmasters({ version: 'v3', auth: oauth2Client });

    // Set date range (last 28 days)
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 28);
    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    console.log(`\n================================ GSC API QUERY START ================================`);
    console.log(`🌐 Site URL: ${domainUrl}`);
    console.log(`📅 Date Range: ${startStr} to ${endStr}`);
    console.log(`=====================================================================================`);

    // Get overview metrics (Date grouped)
    console.log(`[GSC API] Requesting overview metrics...`);
    const overviewRes = await searchconsole.searchanalytics.query({
      siteUrl: domainUrl,
      requestBody: {
        startDate: startStr,
        endDate: endStr,
        dimensions: ['date'],
        rowLimit: 30
      }
    });
    console.log(`[GSC API Response] Overview metrics count: ${overviewRes.data.rows?.length || 0} rows`);
    if (overviewRes.data.rows?.length > 0) {
      console.log(`[GSC API Response] First overview row:`, JSON.stringify(overviewRes.data.rows[0], null, 2));
    }

    // Get Top Queries
    console.log(`[GSC API] Requesting top queries...`);
    const queriesRes = await searchconsole.searchanalytics.query({
      siteUrl: domainUrl,
      requestBody: {
        startDate: startStr,
        endDate: endStr,
        dimensions: ['query'],
        rowLimit: 5
      }
    });
    console.log(`[GSC API Response] Top queries count: ${queriesRes.data.rows?.length || 0} rows`);

    // Get Top Pages
    console.log(`[GSC API] Requesting top pages...`);
    const pagesRes = await searchconsole.searchanalytics.query({
      siteUrl: domainUrl,
      requestBody: {
        startDate: startStr,
        endDate: endStr,
        dimensions: ['page'],
        rowLimit: 5
      }
    });
    console.log(`[GSC API Response] Top pages count: ${pagesRes.data.rows?.length || 0} rows`);

    // Get Device Breakdown
    console.log(`[GSC API] Requesting device breakdown...`);
    const deviceRes = await searchconsole.searchanalytics.query({
      siteUrl: domainUrl,
      requestBody: {
        startDate: startStr,
        endDate: endStr,
        dimensions: ['device']
      }
    });
    console.log(`[GSC API Response] Device rows:`, JSON.stringify(deviceRes.data.rows, null, 2));

    // Get Country Breakdown
    console.log(`[GSC API] Requesting country breakdown...`);
    const countryRes = await searchconsole.searchanalytics.query({
      siteUrl: domainUrl,
      requestBody: {
        startDate: startStr,
        endDate: endStr,
        dimensions: ['country'],
        rowLimit: 5
      }
    });
    console.log(`[GSC API Response] Country rows count: ${countryRes.data.rows?.length || 0} rows`);
    console.log(`================================ GSC API QUERY END ==================================\n`);

    logger.info(`✅ [GSC Service] Successfully fetched real GSC data for ${domainUrl}.`);
    return formatGscData(
      overviewRes.data.rows || [],
      queriesRes.data.rows || [],
      pagesRes.data.rows || [],
      deviceRes.data.rows || [],
      countryRes.data.rows || []
    );

  } catch (error) {
    console.log(`\n================================ GSC API ERROR START ================================`);
    console.error(`❌ Error Message: ${error.message}`);
    console.error(`❌ Error Code: ${error.code}`);
    console.error(`❌ Full Error Details:`, JSON.stringify(error, null, 2));
    console.log(`================================ GSC API ERROR END ==================================\n`);
    logger.error(`❌ [GSC Service] Error fetching GSC data for ${domainUrl}: ${error.message}`);
    throw error;
  }
};

const formatGscData = (overviewRows, queryRows, pageRows, deviceRows, countryRows) => {
  // Aggregate summary
  let totalClicks = 0;
  let totalImpressions = 0;
  let ctrSum = 0;
  let posSum = 0;

  const chartData = { clicks: [], impressions: [], dates: [] };

  overviewRows.forEach(row => {
    totalClicks += row.clicks;
    totalImpressions += row.impressions;
    ctrSum += row.ctr;
    posSum += row.position;
    
    chartData.dates.push(row.keys[0]);
    chartData.clicks.push(row.clicks);
    chartData.impressions.push(row.impressions);
  });

  const rowCount = overviewRows.length || 1;
  const avgCtr = ((ctrSum / rowCount) * 100).toFixed(1) + "%";
  const avgPos = (posSum / rowCount).toFixed(1);

  return {
    summaryMetrics: {
      clicks: { value: totalClicks.toLocaleString(), trend: "+0.0%", isPositive: true },
      impressions: { value: totalImpressions.toLocaleString(), trend: "+0.0%", isPositive: true },
      ctr: { value: avgCtr, trend: "+0.0%", isPositive: true },
      position: { value: avgPos, trend: "+0.0", isPositive: true }
    },
    topKeywords: queryRows.map(r => ({
      keyword: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: (r.ctr * 100).toFixed(1) + "%",
      position: r.position.toFixed(1)
    })),
    topPages: pageRows.map(r => ({
      url: r.keys[0],
      clicks: r.clicks,
      impressions: r.impressions,
      ctr: (r.ctr * 100).toFixed(1) + "%",
      position: r.position.toFixed(1)
    })),
    devicePerformance: deviceRows.map(r => ({
      device: r.keys[0].toUpperCase(),
      clicks: r.clicks,
      percentage: totalClicks > 0 ? Math.round((r.clicks / totalClicks) * 100) : 0,
      icon: r.keys[0].toLowerCase() === 'desktop' ? 'isax-monitor' : 'isax-mobile'
    })),
    countryPerformance: countryRows.map(r => ({
      country: r.keys[0].toUpperCase(),
      clicks: r.clicks,
      impressions: r.impressions
    })),
    indexStatus: {
      indexed: 0,
      notIndexed: 0,
      checkedUrls: 0
    },
    chartData
  };
};
