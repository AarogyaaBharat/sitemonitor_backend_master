import puppeteer from 'puppeteer';
import { URL } from 'url';
import scanDomain from './src/services/seoScanner.js';
import pkg from './src/services/seoScanner.js';
const { SeoScanner } = pkg; // If it's exported that way, but actually scanDomain is default

// Simple CLI to analyze resource loading
async function analyze(targetUrl) {
    if (!targetUrl) {
        console.error('Please provide a URL. Example: node analyze-resources.js https://example.com');
        process.exit(1);
    }

    console.log(`\n🚀 Starting Resource Analysis for: ${targetUrl}\n`);

    try {
        const browser = await puppeteer.launch({ 
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        });

        // We use the internal scanPage logic or just use scanDomain with limits
        // But for a single page analysis, let's look at how scanPage is called.
        // Or better yet, since seoScanner is already setup, let's use it.
        
        // We need to construct the dependencies for scanPage or use scanDomain
        // scanDomain(domainName, options) calls scanPage iteratively.
        // We'll just call scanDomain with pageLimit: 1
        
        const reports = await scanDomain(targetUrl, { 
            pageLimit: 1, 
            executeJs: true,
            fullResourceReport: true 
        });

        if (!reports || reports.length === 0) {
            console.error('No report generated.');
            await browser.close();
            return;
        }

        const report = reports[0];
        const resources = report.resources || [];

        // Categorize resources
        const images = resources.filter(r => r.type === 'image');
        const scripts = resources.filter(r => r.type === 'script');
        const styles = resources.filter(r => r.type === 'stylesheet');
        const others = resources.filter(r => !['image', 'script', 'stylesheet'].includes(r.type));

        const formatTable = (title, list) => {
            console.log(`\n--- ${title} (${list.length}) ---`);
            if (list.length === 0) {
                console.log('None found.');
                return;
            }
            const data = list.map(r => ({
                URL: r.url.length > 80 ? r.url.substring(0, 77) + '...' : r.url,
                Size: r.size,
                'Load Time': r.loadDuration,
                Status: r.status
            })).sort((a, b) => {
                const timeA = parseFloat(a['Load Time']);
                const timeB = parseFloat(b['Load Time']);
                return timeB - timeA;
            });
            console.table(data.slice(0, 20)); // Show top 20 slowest in each category
            if (list.length > 20) console.log(`... and ${list.length - 20} more.`);
        };

        formatTable('IMAGES', images);
        formatTable('SCRIPTS (JS)', scripts);
        formatTable('STYLESHEETS (CSS)', styles);
        formatTable('OTHERS (Fonts, Fetch, etc.)', others);

        console.log('\n🎨 CSS ANALYSIS');
        console.log('----------------');
        if (report.cssAnalysis) {
            console.log(`Internal CSS Size:  ${(report.cssAnalysis.internalCssSize / 1024).toFixed(2)} KB`);
            console.log(`Internal CSS count: ${report.cssAnalysis.internalCssCount}`);
            console.log(`Inline CSS count:   ${report.cssAnalysis.inlineCssCount}`);
            console.log(`Impact level:       ${report.cssAnalysis.totalCssImpact}`);
            console.log(`Recommendation:     ${report.cssAnalysis.recommendation}`);
        } else {
            console.log('No CSS analysis data available.');
        }

        console.log('\nJS ANALYSIS');
        console.log('----------------');
        if (report.jsAnalysis) {
            console.log(`Internal JS Size:   ${(report.jsAnalysis.internalJsSize / 1024).toFixed(2)} KB`);
            console.log(`Internal JS count:  ${report.jsAnalysis.internalJsCount}`);
            console.log(`Impact level:       ${report.jsAnalysis.totalJsImpact}`);
            console.log(`Recommendation:     ${report.jsAnalysis.recommendation}`);
        } else {
            console.log('No JS analysis data available.');
        }

        console.log('\n🏆 SEO & PERFORMANCE SCORE');
        console.log('-------------------------');
        console.log(`Final SEO Score:    ${report.seoScore}/100`);
        if (report.performance.coreWebVitals) {
            const cv = report.performance.coreWebVitals;
            console.log(`LCP: ${cv.LCP.toFixed(2)}s | FCP: ${cv.FCP.toFixed(2)}s | CLS: ${cv.CLS.toFixed(3)} | INP: ${cv.INP.toFixed(2)}s`);
        }

        console.log('\n💡 IMPROVEMENT POINTS');
        console.log('--------------------');
        report.seoImprovements.forEach((imp, i) => {
            console.log(`${i+1}. [${imp.priority.toUpperCase()}] ${imp.type}: ${imp.message}`);
            if (imp.wisdom) console.log(`   Wisdom: ${imp.wisdom}`);
        });

        await browser.close();
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Analysis failed:', error.message);
        process.exit(1);
    }
}

const url = process.argv[2];
analyze(url);
