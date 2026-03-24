#!/usr/bin/env node
/**
 * Design Intelligence — Continuous Pipeline
 *
 * ONE script that runs forever on the GP server.
 * Analyses sites in batches, aggregates after each batch,
 * restarts the Design Engine, then starts the next batch.
 * 
 * Run once: node lib/pipeline-runner.js
 * Or via PM2: npx pm2 start lib/pipeline-runner.js --name intelligence-pipeline
 *
 * It will:
 *   1. Harvest URLs (if not already done)
 *   2. Analyse sites in batches of 50
 *   3. After each batch, aggregate into design-space.json
 *   4. Sleep 30 seconds between batches (rate limiting)
 *   5. Stop when all URLs are done
 *   6. Log everything to data/pipeline.log
 *
 * Server: GhostPost VPS (78.111.89.140)
 * Deploy: Cursor pushes, starts with PM2
 * You never touch it again.
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOG_FILE = path.join(ROOT, 'data', 'pipeline.log');
const PROGRESS_FILE = path.join(ROOT, 'data', 'analysis-progress.json');
const URLS_FILE = path.join(ROOT, 'data', 'harvested-urls.json');

const BATCH_SIZE = 50;
const SLEEP_BETWEEN_BATCHES_MS = 30000; // 30 seconds
const MAX_TOTAL = 5000; // Stop after this many total analyses

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (e) { /* ignore */ }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      const p = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
      return {
        analysed: (p.analysed || []).length,
        failed: (p.failed || []).length,
      };
    } catch (e) { /* ignore */ }
  }
  return { analysed: 0, failed: 0 };
}

function getTotalUrls() {
  if (fs.existsSync(URLS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(URLS_FILE, 'utf-8'));
      let total = 0;
      for (const source of Object.values(data)) {
        total += (source.urls || []).length;
      }
      return total;
    } catch (e) { /* ignore */ }
  }
  return 0;
}

function runScript(scriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [scriptPath, ...args], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: process.env.PATH },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      // Print last meaningful line
      const lines = text.trim().split('\n').filter(l => l.trim());
      if (lines.length > 0) {
        log('  ' + lines[lines.length - 1]);
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`Exit code ${code}: ${stderr.substring(0, 500)}`));
    });

    proc.on('error', reject);
  });
}

async function main() {
  log('═══════════════════════════════════════════════');
  log('  Design Intelligence — Continuous Pipeline');
  log('═══════════════════════════════════════════════');

  // Step 1: Harvest URLs if not already done
  if (!fs.existsSync(URLS_FILE)) {
    log('');
    log('STEP 1: Harvesting URLs from sitemaps...');
    try {
      await runScript(path.join(__dirname, 'harvest-urls.js'));
    } catch (e) {
      log('ERROR harvesting: ' + e.message);
      log('Continuing anyway — will retry next run');
    }
  }

  const totalUrls = getTotalUrls();
  log(`Total URLs available: ${totalUrls}`);

  // Step 2: Analyse in batches
  let batchNumber = 0;

  while (true) {
    const progress = getProgress();
    const done = progress.analysed + progress.failed;

    log('');
    log(`──── Batch ${++batchNumber} ────`);
    log(`Analysed so far: ${progress.analysed} | Failed: ${progress.failed} | Remaining: ${totalUrls - done}`);

    // Check if we're done
    if (progress.analysed >= MAX_TOTAL) {
      log(`Reached maximum of ${MAX_TOTAL} analyses. Stopping.`);
      break;
    }

    if (done >= totalUrls) {
      log('All URLs processed. Pipeline complete.');
      break;
    }

    // Run analyser batch
    log(`Analysing next ${BATCH_SIZE} sites...`);
    try {
      await runScript(path.join(__dirname, 'analyse-sites.js'), ['--limit', String(BATCH_SIZE)]);
    } catch (e) {
      log('ERROR in analysis batch: ' + e.message);
      log('Sleeping 60s before retry...');
      await sleep(60000);
      continue;
    }

    // Aggregate after each batch
    log('Aggregating into design-space.json...');
    try {
      await runScript(path.join(__dirname, 'update-intelligence.js'));
    } catch (e) {
      log('ERROR aggregating: ' + e.message);
    }

    const newProgress = getProgress();
    log(`Batch complete. Total analysed: ${newProgress.analysed} | Failed: ${newProgress.failed}`);

    // Sleep between batches
    log(`Sleeping ${SLEEP_BETWEEN_BATCHES_MS / 1000}s before next batch...`);
    await sleep(SLEEP_BETWEEN_BATCHES_MS);
  }

  // Final aggregation
  log('');
  log('Running final aggregation...');
  try {
    await runScript(path.join(__dirname, 'update-intelligence.js'));
  } catch (e) {
    log('ERROR in final aggregation: ' + e.message);
  }

  const finalProgress = getProgress();
  log('');
  log('═══════════════════════════════════════════════');
  log('  PIPELINE COMPLETE');
  log(`  Total analysed: ${finalProgress.analysed}`);
  log(`  Total failed: ${finalProgress.failed}`);
  log(`  Results: data/design-space.json`);
  log(`  Reports: data/reports/`);
  log('═══════════════════════════════════════════════');
}

main().catch(err => {
  log('FATAL: ' + err.message);
  process.exit(1);
});
