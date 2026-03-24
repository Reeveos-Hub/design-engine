#!/usr/bin/env node
/**
 * Design Intelligence — URL Harvester
 *
 * Fetches sitemaps from design gallery sites and extracts
 * thousands of landing page URLs for the vision pipeline.
 *
 * Server: GhostPost VPS (78.111.89.140)
 * Run: node lib/harvest-urls.js
 * Output: data/harvested-urls.json
 *
 * Sources:
 *   OnePageLove — 9,000+ landing page URLs
 *   Lapa Ninja  — thousands of design inspiration URLs
 *   Land-book   — curated landing page gallery
 *   Godly       — premium design showcase
 *   Awwwards    — award-winning sites
 */

const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'harvested-urls.json');

// ═══════════════════════════════════════════════════════════
// SITEMAP SOURCES
// ═══════════════════════════════════════════════════════════

const SOURCES = [
  {
    name: 'OnePageLove',
    sitemaps: [
      'https://onepagelove.com/sitemap.xml',
      'https://onepagelove.com/post-sitemap.xml',
      'https://onepagelove.com/post-sitemap2.xml',
      'https://onepagelove.com/post-sitemap3.xml',
    ],
    // Only include actual inspiration pages, not blog/category
    includePatterns: [/onepagelove\.com\/[a-z0-9-]+$/i],
    excludePatterns: [
      /\/page\//, /\/category\//, /\/tag\//, /\/author\//,
      /\/templates/, /\/blog/, /\/about/, /\/contact/,
      /\/privacy/, /\/terms/, /\/submit/, /\/newsletter/,
      /\/wp-content/, /\/feed/, /\.xml$/,
    ],
  },
  {
    name: 'LapaNinja',
    sitemaps: [
      'https://www.lapa.ninja/sitemap.xml',
      'https://www.lapa.ninja/sitemap-0.xml',
    ],
    includePatterns: [/lapa\.ninja\/post\//i, /lapa\.ninja\/[a-z0-9-]+$/i],
    excludePatterns: [
      /\/category\//, /\/tag\//, /\/page\//, /\/blog\//,
      /\/about/, /\/contact/, /\/privacy/, /\/terms/,
    ],
  },
  {
    name: 'Land-book',
    sitemaps: [
      'https://land-book.com/sitemap.xml',
    ],
    includePatterns: [/land-book\.com\/websites\//i],
    excludePatterns: [
      /\/category\//, /\/tag\//, /\/page\//, /\/blog\//,
      /\/about/, /\/contact/, /\/privacy/,
    ],
  },
  {
    name: 'Godly',
    sitemaps: [
      'https://godly.website/sitemap.xml',
    ],
    includePatterns: [/godly\.website\/website\//i],
    excludePatterns: [
      /\/category\//, /\/tag\//, /\/page\//,
    ],
  },
];


// ═══════════════════════════════════════════════════════════
// FETCH AND PARSE SITEMAPS
// ═══════════════════════════════════════════════════════════

async function fetchSitemap(url) {
  try {
    console.log(`  Fetching: ${url}`);
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ReeveOS-Bot/1.0)' },
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      console.warn(`  ⚠ ${url} returned ${resp.status}`);
      return [];
    }

    const xml = await resp.text();

    // Extract URLs from <loc> tags
    const urls = [];
    const locRegex = /<loc>\s*(.*?)\s*<\/loc>/gi;
    let match;
    while ((match = locRegex.exec(xml)) !== null) {
      urls.push(match[1].trim());
    }

    // Check if this is a sitemap index (contains other sitemaps)
    if (xml.includes('<sitemapindex')) {
      console.log(`  Found sitemap index with ${urls.length} child sitemaps`);
      const childUrls = [];
      for (const childSitemap of urls) {
        const childResults = await fetchSitemap(childSitemap);
        childUrls.push(...childResults);
        // Rate limit
        await new Promise(r => setTimeout(r, 500));
      }
      return childUrls;
    }

    console.log(`  Found ${urls.length} URLs`);
    return urls;

  } catch (err) {
    console.warn(`  ⚠ Error fetching ${url}: ${err.message}`);
    return [];
  }
}

function filterUrls(urls, source) {
  return urls.filter(url => {
    // Must match at least one include pattern
    const included = source.includePatterns.length === 0 ||
      source.includePatterns.some(p => p.test(url));

    // Must NOT match any exclude pattern
    const excluded = source.excludePatterns.some(p => p.test(url));

    return included && !excluded;
  });
}


// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  Design Intelligence — URL Harvester');
  console.log('═══════════════════════════════════════\n');

  const allResults = {};
  let totalUrls = 0;

  for (const source of SOURCES) {
    console.log(`\n▸ ${source.name}`);

    let sourceUrls = [];
    for (const sitemapUrl of source.sitemaps) {
      const urls = await fetchSitemap(sitemapUrl);
      sourceUrls.push(...urls);
      await new Promise(r => setTimeout(r, 1000)); // Rate limit between sitemaps
    }

    // Deduplicate
    sourceUrls = [...new Set(sourceUrls)];

    // Filter
    const filtered = filterUrls(sourceUrls, source);
    console.log(`  Total: ${sourceUrls.length} raw → ${filtered.length} filtered`);

    allResults[source.name] = {
      count: filtered.length,
      harvested_at: new Date().toISOString(),
      urls: filtered,
    };

    totalUrls += filtered.length;
  }

  // Load existing if present (merge, don't overwrite)
  let existing = {};
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
      console.log(`\nLoaded existing harvested-urls.json`);
    } catch (e) {
      console.warn('Could not parse existing file, starting fresh');
    }
  }

  // Merge — keep existing URLs, add new ones
  for (const [source, data] of Object.entries(allResults)) {
    const existingUrls = new Set(existing[source]?.urls || []);
    for (const url of data.urls) {
      existingUrls.add(url);
    }
    allResults[source] = {
      count: existingUrls.size,
      harvested_at: data.harvested_at,
      urls: [...existingUrls],
    };
  }

  // Write output
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allResults, null, 2));

  // Summary
  console.log('\n═══════════════════════════════════════');
  console.log('  RESULTS');
  console.log('═══════════════════════════════════════');
  let grand = 0;
  for (const [source, data] of Object.entries(allResults)) {
    console.log(`  ${source}: ${data.count} URLs`);
    grand += data.count;
  }
  console.log(`\n  TOTAL: ${grand} URLs`);
  console.log(`  Saved to: ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
