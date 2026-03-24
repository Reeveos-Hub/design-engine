#!/usr/bin/env node
/**
 * Design Intelligence — Aggregator
 *
 * Reads all individual site reports from data/reports/
 * and aggregates them into data/design-space.json with
 * average dimension scores per industry.
 *
 * Server: GhostPost VPS (78.111.89.140)
 * Run: node lib/update-intelligence.js
 * Output: data/design-space.json (used by the Design Engine server)
 *
 * This is the file that feeds into Ollama's context when
 * generating design briefs — it tells Ollama what the
 * science says about each industry's optimal design dimensions.
 */

const fs = require('fs');
const path = require('path');

const REPORTS_DIR = path.join(__dirname, '..', 'data', 'reports');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'design-space.json');

const DIMENSIONS = [
  'visual_complexity', 'colourfulness', 'prototypicality',
  'warmth', 'typography_weight', 'image_dominance',
  'contrast_level', 'layout_density',
];

function main() {
  console.log('═══════════════════════════════════════');
  console.log('  Design Intelligence — Aggregator');
  console.log('═══════════════════════════════════════\n');

  if (!fs.existsSync(REPORTS_DIR)) {
    console.error('No reports directory found. Run analyse-sites.js first.');
    process.exit(1);
  }

  // Read all report files
  const files = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.json'));
  console.log(`Found ${files.length} report files`);

  // Group by industry and accumulate dimensions
  const industries = {};
  let validCount = 0;
  let invalidCount = 0;

  for (const file of files) {
    try {
      const report = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, file), 'utf-8'));
      const industry = report.industry || 'other';
      const dims = report.dimensions;

      if (!dims) {
        invalidCount++;
        continue;
      }

      if (!industries[industry]) {
        industries[industry] = {
          count: 0,
          totals: {},
          quality_sum: 0,
          colours: [],
          layout_patterns: {},
          typography_patterns: {},
        };
        for (const d of DIMENSIONS) {
          industries[industry].totals[d] = 0;
        }
      }

      const ind = industries[industry];
      ind.count++;
      ind.quality_sum += report.quality_score || 5;

      for (const d of DIMENSIONS) {
        const val = parseFloat(dims[d]);
        if (!isNaN(val)) {
          ind.totals[d] += val;
        }
      }

      // Track colour patterns
      if (report.colours?.accent) {
        ind.colours.push(report.colours.accent);
      }

      // Track layout patterns
      if (report.layout?.hero_type) {
        const ht = report.layout.hero_type;
        ind.layout_patterns[ht] = (ind.layout_patterns[ht] || 0) + 1;
      }

      // Track typography patterns
      if (report.typography?.heading_style) {
        const ts = report.typography.heading_style;
        ind.typography_patterns[ts] = (ind.typography_patterns[ts] || 0) + 1;
      }

      validCount++;

    } catch (e) {
      invalidCount++;
    }
  }

  console.log(`Valid reports: ${validCount}`);
  console.log(`Invalid/skipped: ${invalidCount}`);
  console.log(`Industries found: ${Object.keys(industries).length}\n`);

  // Build design-space.json
  const designSpace = {
    generated_at: new Date().toISOString(),
    total_reports: validCount,
    industries: {},
  };

  for (const [industry, data] of Object.entries(industries)) {
    const dimensions = {};
    for (const d of DIMENSIONS) {
      dimensions[d] = data.count > 0
        ? Math.round((data.totals[d] / data.count) * 10) / 10
        : 5;
    }

    // Find most common accent colours (top 5)
    const colourFreq = {};
    for (const c of data.colours) {
      colourFreq[c] = (colourFreq[c] || 0) + 1;
    }
    const topColours = Object.entries(colourFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([c]) => c);

    // Find dominant layout pattern
    const topLayout = Object.entries(data.layout_patterns)
      .sort((a, b) => b[1] - a[1])[0];

    // Find dominant typography
    const topTypo = Object.entries(data.typography_patterns)
      .sort((a, b) => b[1] - a[1])[0];

    designSpace.industries[industry] = {
      count: data.count,
      avg_quality: Math.round((data.quality_sum / data.count) * 10) / 10,
      dimensions,
      common_accent_colours: topColours,
      dominant_hero: topLayout ? topLayout[0] : 'unknown',
      dominant_heading_style: topTypo ? topTypo[0] : 'sans-serif',
    };

    console.log(`  ${industry}: ${data.count} sites, avg quality ${designSpace.industries[industry].avg_quality}`);
    console.log(`    Dimensions: complexity=${dimensions.visual_complexity} colour=${dimensions.colourfulness} warmth=${dimensions.warmth} contrast=${dimensions.contrast_level}`);
  }

  // Write output
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(designSpace, null, 2));
  console.log(`\nSaved to: ${OUTPUT_FILE}`);
  console.log('Design Engine will use this data on next request.');
}

main();
