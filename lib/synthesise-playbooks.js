#!/usr/bin/env node
/**
 * Design Intelligence — Phase 3: Playbook Synthesis
 *
 * Map-Reduce pattern:
 *   MAP: Batch reports per industry, ask Ollama to extract patterns
 *   REDUCE: Feed all batch summaries + statistical findings into
 *           one synthesis call to write the final playbook
 *
 * Server: GhostPost VPS (78.111.89.140)
 * Run: node lib/synthesise-playbooks.js
 * Time: ~2-5 min per industry via Ollama
 * Output: data/playbooks/*.md
 *
 * Every claim in the playbook is backed by data.
 * Ollama does NOT invent rules — it writes up statistical findings.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FEATURES_FILE = path.join(ROOT, 'data', 'features.json');
const STATS_DIR = path.join(ROOT, 'data', 'statistics');
const PLAYBOOKS_DIR = path.join(ROOT, 'data', 'playbooks');

// Load .env
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) process.env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
}

const TOGETHER_API_KEY = process.env.TOGETHER_API_KEY;
const TOGETHER_URL = 'https://api.together.xyz/v1/chat/completions';
const MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

const MAP_BATCH_SIZE = 15;

// ═══════════════════════════════════════════════════════════
// TOGETHER AI HELPER
// ═══════════════════════════════════════════════════════════

async function callLLM(system, prompt, maxTokens = 2000) {
  if (!TOGETHER_API_KEY) throw new Error('TOGETHER_API_KEY not set');

  const resp = await fetch(TOGETHER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + TOGETHER_API_KEY,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(60000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error('Together AI ' + resp.status + ': ' + errText.slice(0, 200));
  }
  const data = await resp.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}


// ═══════════════════════════════════════════════════════════
// MAP STEP: Extract patterns from batches
// ═══════════════════════════════════════════════════════════

async function mapBatch(batch, industry, batchNum) {
  const system = `You are a design data analyst. You are given ${batch.length} website analysis reports for the ${industry.replace(/_/g, ' ')} industry. Extract the common design patterns you observe. Be specific — mention exact colours, font styles, layout types, not vague generalities. Base everything on what you see in the data, not assumptions.`;

  const prompt = `Here are ${batch.length} analysed websites for ${industry.replace(/_/g, ' ')}:\n\n` +
    batch.map((site, i) => {
      const parts = [];
      parts.push(`Site ${i + 1}: quality=${site.quality_score}`);
      if (site.theme) parts.push(`theme=${site.theme}`);
      if (site.primary_bg) parts.push(`bg=${site.primary_bg}`);
      if (site.accent_colour) parts.push(`accent=${site.accent_colour}`);
      if (site.heading_style) parts.push(`heading=${site.heading_style}/${site.heading_weight}`);
      if (site.hero_type) parts.push(`hero=${site.hero_type}`);
      if (site.nav_type) parts.push(`nav=${site.nav_type}`);
      if (site.whitespace_level) parts.push(`whitespace=${site.whitespace_level}`);
      if (site.grid_style) parts.push(`grid=${site.grid_style}`);
      if (site.has_animation) parts.push('animated');
      if (site.has_glassmorphism) parts.push('glassmorphism');
      if (site.has_gradient) parts.push('gradient');
      if (site.cta_shape) parts.push(`cta=${site.cta_shape}`);
      if (site.notable_features?.length) parts.push(`notable: ${site.notable_features.join(', ')}`);
      return parts.join(' | ');
    }).join('\n') +
    `\n\nExtract:\n1. Most common colour patterns (with hex values if available)\n2. Typography patterns (font styles, weights)\n3. Layout patterns (hero types, grid styles, section flow)\n4. What the highest-quality sites (8+) do differently\n5. Notable/distinctive techniques observed\n\nBe specific and data-driven. Reference site counts.`;

  return await callLLM(system, prompt, 1000);
}


// ═══════════════════════════════════════════════════════════
// REDUCE STEP: Synthesise into playbook
// ═══════════════════════════════════════════════════════════

async function reduceToPlaybook(industry, batchSummaries, statistics) {
  const system = `You are writing a Design Intelligence Playbook for the ${industry.replace(/_/g, ' ')} industry. This playbook will be read by an AI that generates website design systems. Every claim must be backed by data — cite site counts, percentages, or p-values. Do NOT include your own opinions or assumptions. If the data doesn't support a claim, don't include it.`;

  let prompt = `Write a Design Intelligence Playbook using the following data.\n\n`;

  // Add statistical findings
  if (statistics) {
    prompt += `=== STATISTICAL FINDINGS ===\n`;

    if (statistics.percentile_profiling) {
      const pp = statistics.percentile_profiling;
      prompt += `\nPercentile Profiling (${pp.total_sites} sites, top ${pp.top_count} vs bottom ${pp.bottom_count}):\n`;
      if (pp.significant_differences?.length) {
        prompt += `Significant differences:\n`;
        for (const diff of pp.significant_differences) {
          prompt += `  - ${diff.feature}: top=${diff.top_mean}, bottom=${diff.bottom_mean} (p=${diff.p_value}, ${diff.direction} is better)\n`;
        }
      }
      if (pp.boolean_differences?.length) {
        prompt += `Boolean feature differences:\n`;
        for (const diff of pp.boolean_differences) {
          prompt += `  - ${diff.feature}: top=${diff.top_pct}%, bottom=${diff.bottom_pct}% (${diff.difference > 0 ? 'more common in top' : 'less common in top'})\n`;
        }
      }
      if (pp.categorical_differences?.length) {
        prompt += `Categorical distributions:\n`;
        for (const diff of pp.categorical_differences.slice(0, 5)) {
          prompt += `  - ${diff.feature}: top=${JSON.stringify(diff.top_distribution)}, bottom=${JSON.stringify(diff.bottom_distribution)}\n`;
        }
      }
    }

    if (statistics.decision_tree) {
      const dt = statistics.decision_tree;
      prompt += `\nDecision Tree Rules (accuracy ${dt.tree_accuracy}):\n`;
      prompt += dt.rules_text + '\n';
      prompt += `Top features by importance: ${dt.top_features.map(f => `${f[0]}(${f[1]})`).join(', ')}\n`;
    }

    if (statistics.archetypes) {
      const aa = statistics.archetypes;
      prompt += `\nArchetypes (${aa.n_archetypes} found):\n`;
      for (const a of aa.archetypes) {
        prompt += `  Archetype ${a.archetype_id} (${a.size} sites, avg quality ${a.avg_quality}):\n`;
        const key_features = Object.entries(a.numeric_profile)
          .filter(([k]) => !['quality_score'].includes(k))
          .map(([k, v]) => `${k}=${v}`)
          .join(', ');
        prompt += `    Numeric: ${key_features}\n`;
        if (a.categorical_profile) {
          const cat = Object.entries(a.categorical_profile).map(([k, v]) => `${k}=${v}`).join(', ');
          prompt += `    Categorical: ${cat}\n`;
        }
      }
    }
  }

  // Add batch summaries
  prompt += `\n=== PATTERN SUMMARIES FROM ${batchSummaries.length} BATCHES ===\n`;
  for (let i = 0; i < batchSummaries.length; i++) {
    prompt += `\nBatch ${i + 1}:\n${batchSummaries[i]}\n`;
  }

  prompt += `\n=== OUTPUT FORMAT ===\n`;
  prompt += `Write the playbook in this exact markdown format:\n\n`;
  prompt += `# Design Intelligence Playbook: ${industry.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}\n\n`;
  prompt += `## Data Summary\n`;
  prompt += `Based on [N] analysed websites, [N] scoring 8+.\n\n`;
  prompt += `## Archetypes\n`;
  prompt += `[3-5 named types with descriptions. Each has: name, description, typical colours, typography, layout.]\n\n`;
  prompt += `## What Top Sites Do (Statistical Evidence)\n`;
  prompt += `[Specific findings from percentile profiling. Every claim cites numbers.]\n\n`;
  prompt += `## Decision Rules\n`;
  prompt += `[Human-readable IF/THEN rules from the decision tree. Include confidence.]\n\n`;
  prompt += `## Colour Patterns\n`;
  prompt += `[Actual hex values and colour strategies observed in top sites.]\n\n`;
  prompt += `## Typography Patterns\n`;
  prompt += `[Font styles, weights, size ratios from top sites.]\n\n`;
  prompt += `## Layout Patterns\n`;
  prompt += `[Hero types, section flows, grid styles, navigation approaches.]\n\n`;
  prompt += `## Signature Elements\n`;
  prompt += `[Distinctive techniques from the best sites — specific, not generic.]\n\n`;
  prompt += `## What To Avoid\n`;
  prompt += `[Patterns correlated with LOW quality scores. Cite the data.]\n\n`;
  prompt += `Every claim must reference the data. No opinions. No assumptions.`;

  return await callLLM(system, prompt, 3000);
}


// ═══════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════

async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  Phase 3: Playbook Synthesis');
  console.log('═══════════════════════════════════════\n');

  // Load features
  if (!fs.existsSync(FEATURES_FILE)) {
    console.error('No features.json. Run extract-features.js first.');
    process.exit(1);
  }
  const allFeatures = JSON.parse(fs.readFileSync(FEATURES_FILE, 'utf-8'));
  console.log(`Loaded ${allFeatures.length} features`);

  // Group by industry
  const byIndustry = {};
  for (const f of allFeatures) {
    const ind = f.industry || 'other';
    if (!byIndustry[ind]) byIndustry[ind] = [];
    byIndustry[ind].push(f);
  }

  // Create playbooks directory
  if (!fs.existsSync(PLAYBOOKS_DIR)) {
    fs.mkdirSync(PLAYBOOKS_DIR, { recursive: true });
  }

  // Find industries with statistics
  const statsFiles = fs.existsSync(STATS_DIR)
    ? fs.readdirSync(STATS_DIR).filter(f => f.endsWith('.json'))
    : [];

  console.log(`Statistics available for: ${statsFiles.map(f => f.replace('.json', '')).join(', ') || 'none'}`);

  // Process each industry that has statistics
  for (const statsFile of statsFiles) {
    const industry = statsFile.replace('.json', '');
    console.log(`\n▸ ${industry}`);

    // Load statistics
    let statistics = null;
    try {
      statistics = JSON.parse(fs.readFileSync(path.join(STATS_DIR, statsFile), 'utf-8'));
    } catch (e) {
      console.log('  ✗ Could not load statistics');
    }

    // Get features for this industry (and related ones)
    let industrySites = byIndustry[industry] || [];

    // Also include related industries if this is a group
    const INDUSTRY_GROUPS = {
      'hair_services': ['barbershop', 'barber', 'hair_salon', 'beauty_salon', 'nail_salon'],
      'health_wellness': ['gym', 'personal_trainer', 'yoga_pilates', 'spa_wellness'],
      'medical': ['aesthetics_clinic', 'dental', 'physiotherapy', 'veterinary'],
      'food_drink': ['restaurant', 'cafe'],
      'creative': ['photography', 'tattoo_piercing', 'portfolio', 'agency'],
      'tech': ['saas', 'ecommerce'],
    };

    if (INDUSTRY_GROUPS[industry]) {
      for (const member of INDUSTRY_GROUPS[industry]) {
        if (byIndustry[member]) {
          industrySites = industrySites.concat(byIndustry[member]);
        }
      }
    }

    if (industrySites.length < 5) {
      console.log(`  ✗ Only ${industrySites.length} sites, skipping`);
      continue;
    }

    // MAP: Batch the sites and extract patterns
    console.log(`  MAP: Processing ${industrySites.length} sites in batches of ${MAP_BATCH_SIZE}...`);
    const batchSummaries = [];
    const batches = [];
    for (let i = 0; i < industrySites.length; i += MAP_BATCH_SIZE) {
      batches.push(industrySites.slice(i, i + MAP_BATCH_SIZE));
    }

    // Limit to 10 batches max (150 sites) to keep Ollama calls manageable
    const batchesToProcess = batches.slice(0, 10);

    for (let i = 0; i < batchesToProcess.length; i++) {
      console.log(`  MAP batch ${i + 1}/${batchesToProcess.length}...`);
      try {
        const summary = await mapBatch(batchesToProcess[i], industry, i + 1);
        batchSummaries.push(summary);
      } catch (e) {
        console.log(`  ✗ Batch ${i + 1} failed: ${e.message}`);
      }
      // Small delay between batches
      await new Promise(r => setTimeout(r, 2000));
    }

    if (batchSummaries.length === 0) {
      console.log('  ✗ No batch summaries generated, skipping');
      continue;
    }

    // REDUCE: Synthesise into playbook
    console.log(`  REDUCE: Synthesising from ${batchSummaries.length} summaries + statistics...`);
    try {
      const playbook = await reduceToPlaybook(industry, batchSummaries, statistics);

      if (playbook.length < 200) {
        console.log('  ✗ Playbook too short, skipping');
        continue;
      }

      // Save
      const outputFile = path.join(PLAYBOOKS_DIR, `${industry}.md`);
      fs.writeFileSync(outputFile, playbook);
      console.log(`  ✓ Saved: ${outputFile} (${playbook.length} chars)`);

    } catch (e) {
      console.log(`  ✗ Synthesis failed: ${e.message}`);
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log('  Playbooks generated');
  if (fs.existsSync(PLAYBOOKS_DIR)) {
    const playbooks = fs.readdirSync(PLAYBOOKS_DIR).filter(f => f.endsWith('.md'));
    for (const pb of playbooks) {
      const size = fs.statSync(path.join(PLAYBOOKS_DIR, pb)).size;
      console.log(`  ${pb}: ${Math.round(size / 1024)}KB`);
    }
  }
  console.log('\n  Next: Update server.js to serve playbooks');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
