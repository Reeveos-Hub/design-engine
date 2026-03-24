#!/usr/bin/env node
/**
 * Design Intelligence — Site Analyser
 *
 * Takes harvested URLs, screenshots them with Playwright,
 * sends screenshots to Together AI vision for analysis,
 * and stores design intelligence reports.
 *
 * Server: GhostPost VPS (78.111.89.140)
 * Run: node lib/analyse-sites.js [--limit 100] [--source OnePageLove]
 * Requires: TOGETHER_API_KEY in /opt/design-engine/.env or /opt/ghostpost/.env
 * Output: data/reports/ folder with JSON files per URL
 *
 * Each report contains:
 *   - Colour palette (extracted hex values)
 *   - Typography (detected fonts and weights)
 *   - Layout pattern (hero type, grid structure, section flow)
 *   - 8 scientific dimensions (Reinecke & Gajos 2014)
 *   - Industry classification
 *   - Quality score (1-10)
 */

const fs = require('fs');
const path = require('path');

// Try to load env from multiple locations
const envPaths = [
  path.join(__dirname, '..', '.env'),
  '/opt/design-engine/.env',
  '/opt/ghostpost/.env',
];
for (const ep of envPaths) {
  if (fs.existsSync(ep)) {
    const lines = fs.readFileSync(ep, 'utf-8').split('\n');
    for (const line of lines) {
      const [key, ...rest] = line.split('=');
      if (key && rest.length) {
        process.env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
      }
    }
    break;
  }
}

const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY;
const URLS_FILE = path.join(__dirname, '..', 'data', 'harvested-urls.json');
const REPORTS_DIR = path.join(__dirname, '..', 'data', 'reports');
const PROGRESS_FILE = path.join(__dirname, '..', 'data', 'analysis-progress.json');

// Together AI vision model
const VISION_MODEL = 'meta-llama/Llama-Vision-Free'; // Free tier
const TOGETHER_URL = 'https://api.together.xyz/v1/chat/completions';

// Rate limiting
const DELAY_BETWEEN_SCREENSHOTS = 3000;  // 3s between Playwright screenshots
const DELAY_BETWEEN_ANALYSIS = 1000;     // 1s between Together AI calls
const MAX_CONCURRENT_SCREENSHOTS = 1;    // Sequential to avoid memory issues


// ═══════════════════════════════════════════════════════════
// ANALYSIS PROMPT (extracts the 8 scientific dimensions)
// ═══════════════════════════════════════════════════════════

const ANALYSIS_PROMPT = `You are a web design analyst. Analyse this website screenshot and extract design intelligence.

Return a JSON object with EXACTLY this structure (no other text, just JSON):

{
  "industry": "one of: barbershop, hair_salon, beauty_salon, restaurant, cafe, gym, spa, dental, aesthetics_clinic, photography, tattoo, ecommerce, saas, portfolio, agency, other",
  "quality_score": 8,
  "dimensions": {
    "visual_complexity": 5,
    "colourfulness": 5,
    "prototypicality": 5,
    "warmth": 5,
    "typography_weight": 5,
    "image_dominance": 5,
    "contrast_level": 5,
    "layout_density": 5
  },
  "colours": {
    "primary_bg": "#hex",
    "secondary_bg": "#hex",
    "text_primary": "#hex",
    "accent": "#hex"
  },
  "typography": {
    "heading_style": "serif/sans-serif/display",
    "heading_weight": "light/regular/bold/extrabold",
    "body_style": "serif/sans-serif",
    "size_contrast": "low/medium/high"
  },
  "layout": {
    "hero_type": "full-bleed/split/centred/minimal/video",
    "nav_style": "transparent/solid/floating/hamburger",
    "grid_style": "standard/asymmetric/bento/masonry",
    "section_count": 7,
    "has_animation": true
  },
  "notable_features": ["frosted glass nav", "overlapping elements", "3d renders"]
}

All dimension scores are 1-10. Be accurate based on what you see.
Return ONLY the JSON. No markdown. No explanation.`;


// ═══════════════════════════════════════════════════════════
// SCREENSHOT WITH PLAYWRIGHT
// ═══════════════════════════════════════════════════════════

let browser = null;

async function initBrowser() {
  if (browser) return browser;
  const { chromium } = require('playwright');
  browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  console.log('Browser launched');
  return browser;
}

async function screenshot(url) {
  const b = await initBrowser();
  const context = await b.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    // Wait a bit for lazy-loaded content
    await page.waitForTimeout(2000);
    // Take full-page screenshot as base64
    const buffer = await page.screenshot({ fullPage: false, type: 'jpeg', quality: 70 });
    return buffer.toString('base64');
  } catch (err) {
    console.warn(`  Screenshot failed for ${url}: ${err.message}`);
    return null;
  } finally {
    await context.close();
  }
}


// ═══════════════════════════════════════════════════════════
// ANALYSE WITH TOGETHER AI VISION
// ═══════════════════════════════════════════════════════════

async function analyseScreenshot(base64Image) {
  if (!TOGETHER_API_KEY) {
    throw new Error('TOGETHER_API_KEY not set. Add it to .env');
  }

  const resp = await fetch(TOGETHER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOGETHER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: ANALYSIS_PROMPT },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${base64Image}` },
            },
          ],
        },
      ],
      max_tokens: 800,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Together AI returned ${resp.status}: ${body.substring(0, 200)}`);
  }

  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content || '';

  // Parse JSON from response (strip markdown fences if present)
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.warn(`  Failed to parse analysis JSON: ${cleaned.substring(0, 200)}`);
    return null;
  }
}


// ═══════════════════════════════════════════════════════════
// PROGRESS TRACKING
// ═══════════════════════════════════════════════════════════

function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
    } catch (e) { /* ignore */ }
  }
  return { analysed: [], failed: [], last_run: null };
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}


// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

async function main() {
  // Parse args
  const args = process.argv.slice(2);
  let limit = 50;  // Default: analyse 50 URLs per run
  let sourceFilter = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[i + 1]);
    if (args[i] === '--source' && args[i + 1]) sourceFilter = args[i + 1];
  }

  console.log('═══════════════════════════════════════');
  console.log('  Design Intelligence — Site Analyser');
  console.log(`  Limit: ${limit} | Source: ${sourceFilter || 'all'}`);
  console.log('═══════════════════════════════════════\n');

  if (!TOGETHER_API_KEY) {
    console.error('ERROR: TOGETHER_API_KEY not found.');
    console.error('Set it in /opt/design-engine/.env or /opt/ghostpost/.env');
    console.error('Get a free key at: https://api.together.xyz');
    process.exit(1);
  }

  // Load harvested URLs
  if (!fs.existsSync(URLS_FILE)) {
    console.error('ERROR: No harvested-urls.json found. Run harvest-urls.js first.');
    process.exit(1);
  }

  const harvested = JSON.parse(fs.readFileSync(URLS_FILE, 'utf-8'));

  // Collect all URLs
  let allUrls = [];
  for (const [source, data] of Object.entries(harvested)) {
    if (sourceFilter && source !== sourceFilter) continue;
    for (const url of data.urls) {
      allUrls.push({ source, url });
    }
  }

  console.log(`Total available URLs: ${allUrls.length}`);

  // Load progress — skip already analysed
  const progress = loadProgress();
  const alreadyDone = new Set([...progress.analysed, ...progress.failed]);
  allUrls = allUrls.filter(u => !alreadyDone.has(u.url));
  console.log(`Already analysed: ${progress.analysed.length}`);
  console.log(`Previously failed: ${progress.failed.length}`);
  console.log(`Remaining: ${allUrls.length}`);
  console.log(`This run: ${Math.min(limit, allUrls.length)}\n`);

  // Create reports directory
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  // Process URLs
  const batch = allUrls.slice(0, limit);
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < batch.length; i++) {
    const { source, url } = batch[i];
    const slug = url.replace(/https?:\/\//, '').replace(/[^a-z0-9]/gi, '-').substring(0, 80);
    const reportPath = path.join(REPORTS_DIR, `${slug}.json`);

    console.log(`[${i + 1}/${batch.length}] ${url}`);

    try {
      // Screenshot
      const base64 = await screenshot(url);
      if (!base64) {
        console.log('  ✗ Screenshot failed');
        progress.failed.push(url);
        failCount++;
        continue;
      }
      console.log('  ✓ Screenshot captured');

      await new Promise(r => setTimeout(r, DELAY_BETWEEN_SCREENSHOTS));

      // Analyse
      const report = await analyseScreenshot(base64);
      if (!report) {
        console.log('  ✗ Analysis failed');
        progress.failed.push(url);
        failCount++;
        continue;
      }

      // Save report
      const fullReport = {
        url,
        source,
        analysed_at: new Date().toISOString(),
        ...report,
      };
      fs.writeFileSync(reportPath, JSON.stringify(fullReport, null, 2));
      progress.analysed.push(url);
      successCount++;

      console.log(`  ✓ Analysed — industry: ${report.industry}, quality: ${report.quality_score}`);

      await new Promise(r => setTimeout(r, DELAY_BETWEEN_ANALYSIS));

    } catch (err) {
      console.log(`  ✗ Error: ${err.message}`);
      progress.failed.push(url);
      failCount++;
    }

    // Save progress every 10 URLs
    if ((i + 1) % 10 === 0) {
      progress.last_run = new Date().toISOString();
      saveProgress(progress);
    }
  }

  // Final save
  progress.last_run = new Date().toISOString();
  saveProgress(progress);

  // Close browser
  if (browser) await browser.close();

  console.log('\n═══════════════════════════════════════');
  console.log('  RESULTS');
  console.log('═══════════════════════════════════════');
  console.log(`  Analysed: ${successCount}`);
  console.log(`  Failed: ${failCount}`);
  console.log(`  Total reports: ${progress.analysed.length}`);
  console.log(`  Reports dir: ${REPORTS_DIR}`);
  console.log('\n  Next: run update-intelligence.js to aggregate into design-space.json');
}

main().catch(err => {
  console.error('Fatal:', err);
  if (browser) browser.close();
  process.exit(1);
});
