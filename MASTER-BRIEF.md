# ReeveOS Design Engine — Complete Build Guide for Cursor
## ONE DOCUMENT. EVERYTHING YOU NEED TO KNOW.
## Date: 22 March 2026

---

## THE BIG PICTURE

We're building a headless website generation engine. No UI. API in, production-ready website out. A business owner signs up, we feed their business info into the engine, and it spits out 3 complete websites with animations, parallax, scroll effects — the works. The client picks one, it goes live on their subdomain, they edit it themselves.

Think of it as our own headless version of Orchids.app or Stitch, but powered by a Design Intelligence Library (DIL) that's been trained on 64,000+ real website designs, components, and code patterns.

There are TWO systems that work together:

1. **Design Intelligence Library (DIL)** — the brain. Scrapes, screenshots, and analyses thousands of website designs and code components. Outputs a design_space.json that maps what good design looks like for every industry and audience type. Lives at `/opt/design-intelligence/`.

2. **Design Engine** — the muscle. Takes business data + the DIL's intelligence, chains Ollama (local, free) with Claude API (paid, powerful), and produces complete HTML/CSS/JS websites. Lives at `/opt/design-engine/`.

Both live on THIS server (78.111.89.140). Both are completely separate from GhostPost. Different directories, different ports, different processes.

---

## THE SERVER

**IP:** 78.111.89.140 (ServerSpace, New Jersey)
**OS:** Ubuntu
**What's already running:**
- GhostPost on port 3000 (DO NOT TOUCH — different project entirely)
- Ollama on port 11434 with Mistral model
- Playwright + Chromium installed
- PM2 installed
- Node.js installed
- Redis running
- PostgreSQL running

**What we're adding:**
- Design Intelligence Pipeline at `/opt/design-intelligence/` (repo already exists, partially running)
- Design Engine API at `/opt/design-engine/` on port 4100 (repo exists, needs building)

**CRITICAL RULE: Do not touch /opt/ghostpost/ or anything GhostPost-related. Ever.**

---

## GITHUB REPOS

**Token:** <YOUR_GITHUB_TOKEN>

| Repo | What | Clone to |
|------|------|----------|
| `Reeveos-Hub/design-intelligence` | The brain — scraping + analysis pipeline | `/opt/design-intelligence/` |
| `Reeveos-Hub/design-engine` | The muscle — generation API | `/opt/design-engine/` |

---

# PART 1: THE DESIGN INTELLIGENCE LIBRARY (DIL)

## What it does

Collects design intelligence from 50+ sources across the internet — template marketplaces, component galleries, code libraries, design showcases. Screenshots them, analyses them using Together AI's vision model, and compiles everything into a `design_space.json` file that the engine uses.

## The science behind it

Based on Reinecke & Gajos 2014 (Harvard) — the largest study ever done on website design preferences. 2.4 million ratings from 40,000 people across 179 countries. Key findings:

- People judge a website in 50 milliseconds
- There is NO universal "good design" — preferences vary by gender, age, education, culture
- The two biggest factors: **visual complexity** (how busy) and **colourfulness** (how vibrant)
- Women prefer more colourful, complex designs than men
- Older people prefer simpler, more familiar layouts
- The sweet spot: novel enough to interest, familiar enough to trust

So instead of scoring sites as "good" or "bad", we measure them on 8 scientific dimensions:

1. **Visual complexity** (1=minimal, 10=dense)
2. **Colourfulness** (1=monochrome, 10=vibrant)
3. **Prototypicality** (1=unexpected, 10=exactly what you'd expect for this industry)
4. **Warmth** (1=cool/clinical, 10=warm/inviting)
5. **Typography weight** (1=thin/elegant, 10=heavy/bold)
6. **Image dominance** (1=text-forward, 10=image-heavy)
7. **Contrast level** (1=soft, 10=dramatic)
8. **Layout density** (1=spacious, 10=packed)

Every template/design gets plotted on these 8 dimensions. The output groups them by industry so the engine knows: "barber shops cluster around complexity=5, colourfulness=3, warmth=3, typography=8, contrast=8" while "hair salons cluster around complexity=5, colourfulness=6, warmth=8, typography=4, contrast=5."

## Current state

- Repo cloned to `/opt/design-intelligence/` (may already be there)
- 146 Framer templates already analysed (from a sandbox session)
- Pipeline partially running
- `all_templates.json` has 551 Framer template URLs
- `space_reports/` has 146 individual analysis results
- `gallery-sources.json` has the COMPLETE list of 50+ sources to scrape (JUST PUSHED)

## What needs to happen

### Step 1: Pull the latest repo
```bash
cd /opt/design-intelligence
git pull
```

### Step 2: Install dependencies
```bash
npm install
```

### Step 3: Update the collection script

The existing `scripts/collect-urls.js` only scrapes Google and seed URLs. It needs to ALSO read from `data/gallery-sources.json` and scrape all those sources using Playwright.

The `gallery-sources.json` file has 4 categories of sources:

**component_galleries** — sites that show individual section designs (heroes, navs, CTAs, footers). Playwright needs to load each page, scroll to load all items, extract the design URLs/screenshots.

**code_libraries** — sites that have actual HTML/CSS code for components (HyperUI, Flowbite, Uiverse, etc.). Playwright loads each component page, extracts the code snippets AND screenshots.

**design_galleries** — sites that show complete websites (Godly, Awwwards, Lapa Ninja, etc.). Playwright loads galleries, extracts website URLs, then screenshots each one.

**template_marketplaces** — Framer (already done), Wix, Squarespace, Webflow, ThemeForest. Playwright loads template pages, finds preview URLs, screenshots them.

Each source in the JSON has a `priority` field (1, 2, or 3). Process all priority 1 sources first, then 2, then 3.

### Step 4: Update the analysis script

The existing `scripts/analyse.js` uses the OLD subjective prompt ("rate quality 1-10, strengths, weaknesses"). It needs replacing with the v2 analysis that measures the 8 scientific dimensions.

The new analysis script is already in the repo as `scripts/analyse-v2.js`. The pipeline orchestrator (`scripts/pipeline.js`) already points to it.

**Together AI configuration:**
- Key: `<YOUR_TOGETHER_AI_KEY>`
- Model: `Qwen/Qwen3-VL-8B-Instruct` (confirmed working — the old Llama 3.2 Vision model moved to non-serverless and no longer works)
- Budget: $5.00
- Cost per analysis: ~$0.0003 (2000 tokens × $0.18/million)
- Max analyses at budget: ~16,000

### Step 5: Update the curation script

`scripts/curate-v2.js` compiles all individual reports into `output/design_space.json`. This is the final output that the Design Engine reads.

### Step 6: Run the pipeline

```bash
cd /opt/design-intelligence
node scripts/pipeline.js
```

This runs all 4 stages in order:
1. Collect URLs from all sources
2. Screenshot with Playwright
3. Analyse with Together AI
4. Compile into design_space.json

Or run individual stages:
```bash
node scripts/pipeline.js --only 1   # Just collect
node scripts/pipeline.js --from 2   # Resume from screenshots
node scripts/pipeline.js --only 4   # Just compile what we have
```

The pipeline has progress tracking and resumes where it left off if interrupted.

### The priority sources to scrape FIRST

These are the highest value — get these before anything else:

1. **Unsection** (unsection.com) — 2,000+ real website sections categorised by type. This is literally our component reference library. Sections: hero, navbar, footer, testimonial, pricing, FAQ, team, contact, blog, logo, portfolio.

2. **Navbar Gallery** (navbar.gallery) — Every navigation pattern that exists.

3. **CTA Gallery** (cta.gallery) — Every call-to-action pattern.

4. **Component Gallery** (component.gallery/design-systems/) — How real design systems structure components.

5. **Rebrand Gallery** (rebrand.gallery) — Premium brand redesigns. The highest quality bar.

6. **Godly** (godly.website) — Hand-curated with animated previews showing motion design.

7. **HyperUI** (hyperui.dev) — Free Tailwind CSS components WITH CODE. We can extract both the visual pattern AND the implementation.

8. **Flowbite** (flowbite.com) — 450+ Tailwind sections WITH CODE.

---

# PART 2: THE DESIGN ENGINE

## What it does

Takes business information, reads the DIL's design_space.json, and produces 3 complete production-ready websites. Each one is a single HTML file with embedded CSS and JS — animations, parallax, scroll effects, hover interactions, the full works.

## The chain (5 stages)

```
POST /api/generate { business_name, industry, services, phone, email, ... }
  │
  ▼
STAGE 1: INTAKE
  Validate input, look up industry in design_space.json,
  pull audience profile, load industry recipe
  │
  ▼
STAGE 2: DESIGN BRIEF (Ollama — Mistral — LOCAL, FREE)
  Ollama reads the entire design language:
  - Industry cluster coordinates from design_space.json
  - Animation/interaction catalogue (40+ CSS/JS patterns)
  - Industry recipe (section order + content guidance)
  
  Outputs 3 DIFFERENT design briefs — like a creative director
  writing specs for 3 different designers. Each brief specifies:
  exact hex colours, font names, animation classes, section layouts,
  image treatments, spacing values, hover effects. Everything.
  
  Variation strategy:
  1: Closest to industry average (the "expected" premium version)
  2: Shift warm — more imagery, serif headings, editorial luxury
  3: Shift cool — bolder type, higher contrast, modern/geometric
  │
  ▼
STAGE 3: GENERATION (Claude API — Sonnet — PAID, ~$0.04 for all 3)
  Claude API receives each brief + business content +
  the complete animation/interaction code library.
  
  It assembles a complete single-file HTML website using the
  animation patterns, following the brief exactly.
  
  All 3 variations run in parallel (Promise.all).
  │
  ▼
STAGE 4: VALIDATION (Playwright — LOCAL, FREE)
  Each generated HTML gets:
  - Opened in Playwright at 1440px and 375px
  - Screenshotted (proves it renders, not blank)
  - Basic checks (has <html lang=, <meta viewport, sections exist)
  - If broken: send back to Claude for fix pass (max 2 retries)
  │
  ▼
STAGE 5: OUTPUT
  Returns JSON with 3 variations, each containing:
  - Complete HTML string
  - Desktop + mobile screenshots (base64 PNG)
  - Token usage + cost
```

## The repo

`Reeveos-Hub/design-engine` contains everything:

```
/opt/design-engine/
  CURSOR-BUILD-BRIEF.md          ← Detailed build instructions (READ THIS)
  Design-Engine-Architecture.md  ← Architecture reference
  package.json                   ← Express + Playwright deps
  .env.example                   ← API key template
  data/
    animation-library.css        ← 40+ CSS animation/interaction patterns (PROVIDED)
    animation-library.js         ← Scroll reveal, parallax, counters, nav effects (PROVIDED)
    industry-recipes.json        ← Section order + content guidance for 18 industries (PROVIDED)
    ollama-system-prompt.md      ← The prompt that makes Ollama write design briefs (PROVIDED)
    claude-system-prompt.md      ← The prompt that makes Claude write HTML (PROVIDED)
  lib/                           ← YOU BUILD THESE:
    intake.js                    ← Stage 1
    brief.js                     ← Stage 2 (calls Ollama at localhost:11434)
    generate.js                  ← Stage 3 (calls Claude API)
    validate.js                  ← Stage 4 (Playwright screenshots)
    output.js                    ← Stage 5 (package response)
  server.js                      ← YOU BUILD THIS: Express API on port 4100
```

**Everything in `data/` is already written. Don't modify those files.** They contain the animation patterns, industry recipes, and AI prompts that have been carefully crafted.

**What you build:** `server.js` and the 5 files in `lib/`. Follow `CURSOR-BUILD-BRIEF.md` for exact specifications of each file.

## Setup

```bash
cd /opt
git clone https://<YOUR_GITHUB_TOKEN>@github.com/Reeveos-Hub/design-engine.git
cd design-engine
npm install
```

Create `.env`:
```
ANTHROPIC_API_KEY=<check /opt/ghostpost/.env or ask Ambassador>
OLLAMA_URL=http://localhost:11434
PORT=4100
NODE_ENV=production
```

## Ollama integration

Ollama is ALREADY RUNNING on this server. Verify:
```bash
curl http://localhost:11434/api/tags
```
Should show `mistral` in the models list.

To call it from Node.js:
```javascript
const response = await fetch('http://localhost:11434/api/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'mistral',
    prompt: '...the design brief prompt with all the design language loaded...',
    stream: false,
    options: { temperature: 0.8, num_predict: 4000 }
  })
});
const data = await response.json();
const briefText = data.response;
```

The system prompt for Ollama is in `data/ollama-system-prompt.md`. Load that file, then append the business data + design space coordinates + animation catalogue as the user prompt.

## Claude API integration

```javascript
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json'
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 16000,
    system: systemPrompt,      // from data/claude-system-prompt.md
    messages: [{
      role: 'user',
      content: designBrief + '\n\n' + businessContent + '\n\n' + animationCSS + '\n\n' + animationJS
    }]
  })
});
```

The system prompt is in `data/claude-system-prompt.md`. The user prompt combines: the design brief from Ollama + business content + the full animation library (CSS + JS from the data/ files).

Claude outputs a SINGLE complete HTML document. Strip any markdown fences (```html) if present.

## Validation with Playwright

```javascript
const { chromium } = require('playwright');

async function validate(htmlString) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  
  // Write HTML to temp file
  const tmpPath = '/opt/design-engine/output/temp-' + Date.now() + '.html';
  fs.writeFileSync(tmpPath, htmlString);
  
  await page.goto('file://' + tmpPath, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000); // Let animations settle
  
  const desktopScreenshot = await page.screenshot({ type: 'png' });
  
  await page.setViewportSize({ width: 375, height: 812 });
  const mobileScreenshot = await page.screenshot({ type: 'png' });
  
  await browser.close();
  fs.unlinkSync(tmpPath);
  
  return {
    desktop: desktopScreenshot.toString('base64'),
    mobile: mobileScreenshot.toString('base64'),
    valid: desktopScreenshot.length > 50000 // Not blank
  };
}
```

## Testing

Once built, start with PM2:
```bash
pm2 start server.js --name design-engine
pm2 save
```

Test:
```bash
curl -X POST http://localhost:4100/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "business_name": "Test Barber Shop",
    "industry": "barber",
    "tagline": "Premium grooming for the modern gentleman",
    "services": [
      {"name": "Classic Cut", "price": "£18"},
      {"name": "Hot Towel Shave", "price": "£22"},
      {"name": "Beard Trim", "price": "£12"}
    ],
    "phone": "0115 123 4567",
    "email": "hello@testbarber.com",
    "address": "45 High Street, Nottingham, NG1 2AB"
  }'
```

Should return 3 complete HTML websites with screenshots within ~60 seconds.

---

# PART 3: HOW THE TWO SYSTEMS CONNECT

```
DIL Pipeline                          Design Engine
─────────────                         ─────────────
Scrapes 50+ sources          ──►      Reads design_space.json
Screenshots with Playwright           on every /api/generate request
Analyses with Together AI     
Compiles design_space.json   ──►      Ollama uses industry clusters
                                      to write targeted briefs
gallery-sources.json tells            
pipeline WHAT to scrape               Claude API uses briefs +
                                      animation library to write HTML
                                      
                                      Playwright validates output
```

The DIL runs ONCE (or periodically to refresh). It builds the knowledge base.
The Engine runs ON DEMAND. Every time someone requests a website.

The connection point is `design_space.json`:
- DIL writes it to `/opt/design-intelligence/output/design_space.json`
- Engine reads it from there (symlink or direct path)

If `design_space.json` doesn't exist yet (DIL still running), the Engine uses fallback defaults from its config.js. It still works — just with less precise targeting.

---

# PART 4: BUILD ORDER

## Phase 1: Get the Engine skeleton running (DO THIS FIRST)
1. Clone design-engine repo to /opt/design-engine/
2. `npm install`
3. Create .env with Anthropic key
4. Build server.js (Express on 4100, health check, generate endpoint)
5. Build lib/intake.js (validation + fallback config)
6. Build lib/brief.js (Ollama call)
7. Build lib/generate.js (Claude API call)
8. Build lib/validate.js (Playwright screenshots)
9. Build lib/output.js (package response)
10. `pm2 start server.js --name design-engine`
11. Test with curl

## Phase 2: Supercharge the DIL
1. Pull latest design-intelligence repo
2. Update collect-urls.js to read gallery-sources.json
3. Add Playwright scrapers for each priority 1 source
4. Run collection for priority 1 sources
5. Run analysis pipeline
6. Compile design_space.json
7. Verify Engine now reads the real design_space.json

## Phase 3: Expand DIL sources
1. Add priority 2 sources
2. Add code extraction from code libraries (HyperUI, Flowbite, etc.)
3. Re-run analysis
4. Re-compile design_space.json

---

# CRITICAL RULES

1. **DO NOT touch /opt/ghostpost/** — completely separate project
2. **DO NOT install global npm packages** — use local node_modules only
3. **DO NOT change port assignments** for existing services
4. **All API keys in .env** — never hardcoded
5. **The data/ files in design-engine are PROVIDED** — don't modify them
6. **Ollama is LOCAL** (localhost:11434) — free, no rate limits, no API key needed
7. **Claude API costs money** — log token usage in every response
8. **Together AI budget is $5** — the pipeline must stop when budget is reached
9. **If design_space.json doesn't exist yet, use fallback defaults** — don't crash
10. **Every generated HTML must be a SINGLE file** — embedded CSS and JS, no external deps except Google Fonts
