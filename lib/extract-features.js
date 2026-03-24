#!/usr/bin/env node
/**
 * Design Intelligence — Phase 1: Feature Extraction
 *
 * Reads raw reports from data/reports/, normalises each into
 * a consistent 30+ field schema via Ollama (Mistral, JSON mode),
 * and saves to data/features.json.
 *
 * Server: GhostPost VPS (78.111.89.140)
 * Run: node lib/extract-features.js
 * Time: ~2-5s per report, ~3-5 hours for 3,000 reports
 * Resumable: skips already-extracted URLs
 */

const fs = require('fs');
const path = require('path');

// Load .env manually (no dotenv dependency needed)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
}

const REPORTS_DIR = path.join(__dirname, '..', 'data', 'reports');
const OUTPUT_FILE = path.join(__dirname, '..', 'data', 'features.json');
const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY;
const TOGETHER_URL = 'https://api.together.xyz/v1/chat/completions';
// Fast hosted model — does JSON extraction in 2-3s instead of 120s on local CPU
const MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

const EXTRACTION_PROMPT = `You are a design data analyst. Given a raw website analysis report (JSON), extract EXACTLY the fields below into a flat JSON object. If a field is missing from the input, make your best guess based on the data available.

Return ONLY valid JSON. No markdown. No explanation. No backticks.

Required fields:
{
  "url": "string",
  "source": "string (OnePageLove/LapaNinja/Land-book/Godly/other)",
  "industry": "string (barbershop/hair_salon/beauty_salon/nail_salon/aesthetics_clinic/restaurant/cafe/gym/personal_trainer/yoga_pilates/spa_wellness/tattoo_piercing/dental/physiotherapy/photography/veterinary/ecommerce/saas/portfolio/agency/other)",
  "quality_score": 7,
  "theme": "light or dark",
  "primary_bg": "#hex",
  "secondary_bg": "#hex",
  "text_colour": "#hex",
  "accent_colour": "#hex",
  "colour_count": 4,
  "heading_style": "serif/sans-serif/display/mono",
  "heading_weight": "light/regular/bold/extrabold",
  "body_style": "serif/sans-serif",
  "font_family_count": 2,
  "hero_type": "full-bleed/split/centred/minimal/video/none",
  "hero_height_pct": 80,
  "nav_type": "transparent/solid/floating/hamburger/sidebar",
  "section_count": 7,
  "has_gallery": false,
  "has_testimonials": false,
  "has_pricing": false,
  "has_video": false,
  "has_animation": true,
  "has_glassmorphism": false,
  "has_gradient": false,
  "has_parallax": false,
  "card_style": "bordered/borderless/shadow/none",
  "cta_shape": "pill/rectangle/rounded",
  "whitespace_level": "tight/moderate/generous",
  "grid_style": "standard/asymmetric/bento/masonry",
  "visual_complexity": 5,
  "colourfulness": 5,
  "prototypicality": 5,
  "warmth": 5,
  "typography_weight": 5,
  "image_dominance": 5,
  "contrast_level": 5,
  "layout_density": 5,
  "notable_features": ["list", "of", "notable", "design", "choices"]
}

All dimension scores 1-10. Booleans must be true/false. Numeric fields must be numbers.`;

async function extractFeatures(report) {
  if (!TOGETHER_API_KEY) throw new Error('TOGETHER_API_KEY not set in .env');

  const resp = await fetch(TOGETHER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + TOGETHER_API_KEY,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: 'Extract features from this report:\n\n' + JSON.stringify(report) },
      ],
      temperature: 0.1,
      max_tokens: 1200,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error('Together AI ' + resp.status + ': ' + errText.slice(0, 200));
  }

  const data = await resp.json();
  const text = (data.choices?.[0]?.message?.content || '').trim();

  // Parse — strip markdown fences if present
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned);
}

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  Phase 1: Feature Extraction');
  console.log('═══════════════════════════════════════\n');

  if (!fs.existsSync(REPORTS_DIR)) {
    console.error('No reports directory. Run the analyser first.');
    process.exit(1);
  }

  // Load existing features (for resume)
  let existing = [];
  const extractedUrls = new Set();
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
      for (const f of existing) extractedUrls.add(f.url);
      console.log(`Loaded ${existing.length} existing features`);
    } catch (e) { /* start fresh */ }
  }

  // Read all report files
  const files = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.json'));
  console.log(`Total reports: ${files.length}`);

  // Filter to unprocessed
  const toProcess = [];
  for (const file of files) {
    try {
      const report = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, file), 'utf-8'));
      if (!extractedUrls.has(report.url)) {
        toProcess.push({ file, report });
      }
    } catch (e) { /* skip bad files */ }
  }

  console.log(`Already extracted: ${extractedUrls.size}`);
  console.log(`To process: ${toProcess.length}\n`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const { file, report } = toProcess[i];
    console.log(`[${i + 1}/${toProcess.length}] ${report.url || file}`);

    try {
      const features = await extractFeatures(report);
      // Ensure URL is preserved
      features.url = report.url || features.url;
      features.source = report.source || features.source;
      existing.push(features);
      successCount++;
      console.log(`  ✓ ${features.industry} | quality: ${features.quality_score} | theme: ${features.theme}`);
    } catch (e) {
      console.log(`  ✗ ${e.message}`);
      failCount++;
    }

    // Save every 25 to avoid losing progress
    if ((i + 1) % 25 === 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));
      console.log(`  [saved ${existing.length} features]`);
    }

    // Small delay for Together AI rate limiting (much faster than Ollama)
    await new Promise(r => setTimeout(r, 200));
  }

  // Final save
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(existing, null, 2));

  console.log('\n═══════════════════════════════════════');
  console.log(`  Extracted: ${successCount}`);
  console.log(`  Failed: ${failCount}`);
  console.log(`  Total features: ${existing.length}`);
  console.log(`  Saved to: ${OUTPUT_FILE}`);
  console.log('  Next: python3 lib/analyse-patterns.py');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
