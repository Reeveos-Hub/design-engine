# CURSOR BUILD BRIEF — ReeveOS Design Engine
## Read this FIRST before touching anything

---

## WHAT YOU'RE BUILDING

A headless API that generates complete production-ready websites. No UI. Command in, website out. It runs on THIS server (78.111.89.140) alongside GhostPost but completely separate from it.

**Port:** 4100
**Directory:** /opt/design-engine/
**Process manager:** PM2 (already installed)
**DO NOT** touch anything in /opt/ghostpost/

---

## WHAT'S ALREADY ON THIS SERVER

- **Node.js** — already installed
- **Playwright + Chromium** — already installed (GhostPost uses it)
- **Ollama** — already running with Mistral model (check: `curl http://localhost:11434/api/tags`)
- **PM2** — already installed
- **Design Intelligence Pipeline** — at /opt/design-intelligence/ (may still be running, don't touch it)

---

## THE CHAIN (5 stages)

```
POST /api/generate { business data }
  → Stage 1: INTAKE (validate, lookup industry in design_space.json)
  → Stage 2: BRIEF (Ollama/Mistral writes 3 design briefs locally, FREE)
  → Stage 3: GENERATE (Claude API Sonnet turns each brief into complete HTML)
  → Stage 4: VALIDATE (Playwright screenshots to confirm it renders)
  → Stage 5: OUTPUT (return 3 HTML files + screenshots)
```

---

## FILE STRUCTURE TO CREATE

```
/opt/design-engine/
  package.json
  .env                          ← API keys
  server.js                     ← Express server on port 4100
  config.js                     ← All configuration
  lib/
    intake.js                   ← Stage 1: validate input, lookup industry
    brief.js                    ← Stage 2: call Ollama for design briefs
    generate.js                 ← Stage 3: call Claude API for HTML generation
    validate.js                 ← Stage 4: Playwright render check
    output.js                   ← Stage 5: package response
  data/
    animation-library.css       ← PROVIDED IN THIS PACKAGE
    animation-library.js        ← PROVIDED IN THIS PACKAGE
    industry-recipes.json       ← PROVIDED IN THIS PACKAGE
    ollama-system-prompt.md     ← PROVIDED IN THIS PACKAGE
    claude-system-prompt.md     ← PROVIDED IN THIS PACKAGE
    design_space.json           ← symlink to /opt/design-intelligence/output/design_space.json
  output/                       ← generated sites (temp, auto-cleaned)
```

---

## .env FILE

```
ANTHROPIC_API_KEY=<get from /opt/ghostpost/.env or ask Ambassador>
OLLAMA_URL=http://localhost:11434
PORT=4100
NODE_ENV=production
```

---

## server.js REQUIREMENTS

- Express on port 4100
- Single endpoint: POST /api/generate
- Health check: GET /api/health
- CORS enabled (portal.rezvo.app, adminportal.reeveos.app need to call it)
- Request body limit: 5MB (images may be included later)
- Timeout: 120 seconds (generation takes time)
- Error handling: return proper JSON errors, never crash

---

## lib/intake.js

Takes the request body, validates it, enriches it:

1. Required fields: business_name, industry
2. Validate industry against known list (see config.js)
3. Load design_space.json from /opt/design-intelligence/output/
   - If file doesn't exist yet (pipeline still running), use fallback defaults from config
4. Extract industry cluster centre (the 8 dimension averages)
5. Extract audience profile from config
6. Load industry recipe from industry-recipes.json
7. Return enriched object to next stage

---

## lib/brief.js

Calls Ollama locally to generate 3 design briefs:

```javascript
const response = await fetch('http://localhost:11434/api/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'mistral',
    prompt: buildPrompt(businessData, designSpace, recipe, animationLibrary),
    stream: false,
    options: { temperature: 0.8, num_predict: 4000 }
  })
});
```

The system prompt and brief template are in data/ollama-system-prompt.md.
Load it, inject the business data + design space coordinates + animation library catalogue.

Ollama must output 3 DIFFERENT briefs — not 3 versions of the same thing. 
Variation strategy:
- Variation 1: closest to industry cluster centre (the "expected" design)
- Variation 2: shift warm on warmth axis, more image-heavy, serif headings
- Variation 3: shift cool on warmth axis, bolder typography, higher contrast

Parse the output into 3 structured brief objects.

---

## lib/generate.js

Calls Claude API (Sonnet) for each of the 3 briefs:

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
    system: systemPrompt,  // from data/claude-system-prompt.md
    messages: [{ role: 'user', content: userPrompt }]
  })
});
```

The system prompt is in data/claude-system-prompt.md.
The user prompt combines: the design brief + the business content + the animation library (CSS + JS).

Extract the HTML from the response. Claude should output ONLY HTML, no markdown fences.
If the response contains ```html fences, strip them.

Run all 3 variations in parallel (Promise.all) to save time.

---

## lib/validate.js

Uses Playwright to check each generated HTML:

1. Write HTML to temp file in /opt/design-engine/output/
2. Open with Playwright at 1440×900
3. Wait 2 seconds for animations to settle
4. Screenshot → store as base64 PNG
5. Check: page is not blank (screenshot file > 50KB)
6. Screenshot at 375×812 (mobile) too
7. Basic checks: <html lang=, <meta viewport, at least one <section>
8. If blank/broken: return error flag (caller can retry with Claude)

---

## lib/output.js

Package the final response:

```javascript
{
  status: 'success',
  business: 'Rejuvenate Skin Experts',
  industry: 'aesthetics_clinic',
  generated_at: new Date().toISOString(),
  variations: [
    {
      id: 'v1-...',
      label: '...from brief...',
      html: '<full HTML>',
      screenshots: { desktop: 'base64...', mobile: 'base64...' },
      tokens_used: 4200
    },
    // ...v2, v3
  ],
  total_tokens: 12400,
  generation_time_ms: 38000
}
```

Save the HTML files to /opt/design-engine/output/{timestamp}/ for debugging.
Clean output/ directory of anything older than 7 days on server start.

---

## config.js

```javascript
module.exports = {
  port: process.env.PORT || 4100,
  
  anthropic: {
    model: 'claude-sonnet-4-20250514',
    maxTokens: 16000,
  },
  
  ollama: {
    url: process.env.OLLAMA_URL || 'http://localhost:11434',
    model: 'mistral',
    temperature: 0.8,
    maxTokens: 4000,
  },
  
  designSpacePath: '/opt/design-intelligence/output/design_space.json',
  
  industries: [
    'hair_salon', 'barber', 'beauty_salon', 'nail_salon', 'aesthetics_clinic',
    'spa_wellness', 'massage_therapy', 'restaurant', 'cafe', 'bar_pub', 'bistro',
    'takeaway', 'gym', 'personal_trainer', 'yoga_pilates', 'dental',
    'physiotherapy', 'optician', 'veterinary', 'tattoo_piercing', 'photography',
    'tutoring', 'generic_business',
  ],
  
  // Fallback industry defaults if design_space.json not ready yet
  fallbackClusters: {
    hair_salon:        { visual_complexity: 5, colourfulness: 6, warmth: 8, typography_weight: 4, contrast_level: 5 },
    barber:            { visual_complexity: 5, colourfulness: 3, warmth: 3, typography_weight: 8, contrast_level: 8 },
    restaurant:        { visual_complexity: 5, colourfulness: 5, warmth: 7, typography_weight: 5, contrast_level: 5 },
    gym:               { visual_complexity: 6, colourfulness: 4, warmth: 3, typography_weight: 8, contrast_level: 9 },
    dental:            { visual_complexity: 3, colourfulness: 3, warmth: 4, typography_weight: 4, contrast_level: 5 },
    aesthetics_clinic: { visual_complexity: 4, colourfulness: 4, warmth: 6, typography_weight: 4, contrast_level: 5 },
    spa_wellness:      { visual_complexity: 3, colourfulness: 4, warmth: 7, typography_weight: 3, contrast_level: 4 },
    tattoo_piercing:   { visual_complexity: 5, colourfulness: 2, warmth: 2, typography_weight: 7, contrast_level: 9 },
    generic_business:  { visual_complexity: 4, colourfulness: 4, warmth: 5, typography_weight: 5, contrast_level: 5 },
  },

  audienceProfiles: {
    women_25_45:        { colourfulness: [5,8], warmth: [5,9], visual_complexity: [4,7] },
    men_20_40:          { colourfulness: [2,6], contrast_level: [5,9], typography_weight: [5,9] },
    families_mixed:     { prototypicality: [7,10], visual_complexity: [2,6], warmth: [4,8] },
    older_adults_55:    { visual_complexity: [1,5], layout_density: [1,5], prototypicality: [7,10] },
    young_adults_18_30: { visual_complexity: [4,8], prototypicality: [3,7] },
  },

  industryAudiences: {
    hair_salon: 'women_25_45', barber: 'men_20_40', beauty_salon: 'women_25_45',
    nail_salon: 'women_25_45', aesthetics_clinic: 'women_25_45', spa_wellness: 'women_25_45',
    restaurant: 'families_mixed', cafe: 'young_adults_18_30', bar_pub: 'men_20_40',
    gym: 'men_20_40', personal_trainer: 'men_20_40', yoga_pilates: 'women_25_45',
    dental: 'older_adults_55', physiotherapy: 'older_adults_55', optician: 'older_adults_55',
    veterinary: 'families_mixed', tattoo_piercing: 'young_adults_18_30',
    photography: 'women_25_45', tutoring: 'families_mixed', generic_business: 'families_mixed',
  },
};
```

---

## PM2 SETUP

```bash
cd /opt/design-engine
npm install
pm2 start server.js --name design-engine
pm2 save
```

---

## TESTING

Once running, test with:

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

Should return 3 complete HTML variations with screenshots within ~60 seconds.

---

## CRITICAL RULES

1. DO NOT touch /opt/ghostpost/ in any way
2. DO NOT install global npm packages — use local node_modules only
3. DO NOT change any port assignments for existing services
4. The engine is STATELESS — no database, no persistent storage except temp output files
5. All API keys in .env file ONLY, never in code
6. If design_space.json doesn't exist yet, use fallbackClusters from config — don't crash
7. Ollama calls are LOCAL (http://localhost:11434) — free, no rate limits
8. Claude API calls cost money — log token usage in every response
