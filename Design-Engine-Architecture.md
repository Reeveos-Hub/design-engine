# ReeveOS Design Engine — Architecture Specification
## Headless Website Generation System
**Date:** 22 March 2026

---

## What This Is

A headless API that lives on the GhostPost server (78.111.89.140). No interface. Command in, website out. Completely separate from GhostPost — different directory, different process, different port.

When Growth Hub sends "build a website for Rejuvenate Skin Experts, aesthetics clinic, Barry, Cardiff" — the engine outputs a complete, production-ready website with animations, parallax, scroll effects, 3D elements, the works. Three variations. Ready to deploy.

---

## Where It Lives

```
GP Server: 78.111.89.140

/opt/ghostpost/          ← GhostPost (DO NOT TOUCH)
/opt/design-intelligence/ ← Design language library (pipeline output, running now)
/opt/design-engine/       ← THIS — the generation engine (NEW)
```

Port: 4100 (nothing else using it)
Process: Standalone Node.js service via PM2
Database: None — stateless. Takes input, produces output.

---

## The Chain

```
REQUEST
  ↓
[1] INTAKE — validate input, look up industry, pull audience profile
  ↓
[2] DESIGN BRIEF — Ollama (Mistral, local) reads the design language library
    and writes a detailed design brief for this specific business
  ↓
[3] GENERATION — Claude API (Sonnet) receives the brief + component specs +
    animation/interaction library and writes complete HTML/CSS/JS
  ↓
[4] VALIDATION — check output renders, check accessibility, check responsive
  ↓
[5] OUTPUT — 3 variations returned as complete HTML files
  ↓
RESPONSE
```

---

## Stage 1: INTAKE

**API endpoint:** `POST /api/generate`

**Input:**
```json
{
  "business_name": "Rejuvenate Skin Experts",
  "industry": "aesthetics_clinic",
  "location": "Barry, Cardiff",
  "tagline": "Advanced skin treatments in a relaxed clinical setting",
  "services": [
    { "name": "Microneedling", "price": "£150", "duration": "60 min" },
    { "name": "Chemical Peel", "price": "£95", "duration": "45 min" },
    { "name": "RF Needling", "price": "£200", "duration": "75 min" }
  ],
  "staff": [
    { "name": "Natalie", "role": "Owner & Lead Therapist" },
    { "name": "Grace", "role": "Skin Specialist" }
  ],
  "phone": "01onal 234 5678",
  "email": "hello@rejuvenate.co.uk",
  "address": "123 High Street, Barry, CF62 7AA",
  "hours": "Mon-Sat 9am-6pm",
  "images": [],
  "brand_colours": {
    "primary": null,
    "accent": null
  },
  "variations": 3
}
```

**What intake does:**
1. Validates required fields
2. Looks up industry cluster from `design_space.json` (the pipeline output)
3. Looks up audience profile from config (aesthetics_clinic → women_25_45)
4. Pulls the design space coordinates for that industry
5. Selects 5 reference templates closest to those coordinates
6. Passes everything to Stage 2

---

## Stage 2: DESIGN BRIEF (Ollama — Mistral, local on GP)

This is the wall. The AI cannot generate code until it has absorbed and understood the design language.

**What gets loaded into Ollama's context:**

1. **Industry cluster data** from design_space.json:
   - Average dimensions for this industry (complexity, colourfulness, warmth, etc.)
   - Range of acceptable values
   - Common section patterns
   - Common typography pairings
   - Common colour schemes

2. **The animation & interaction library** (see below — a catalogue of CSS/JS effects):
   - Parallax scroll effects
   - Fade-in-on-scroll reveals
   - Floating/rotating elements
   - Curved section dividers
   - Gradient overlays
   - Image treatment effects (blur, overlay, tilt)
   - Hover micro-interactions
   - Counter animations
   - Marquee/ticker strips
   - Glassmorphism cards

3. **Audience targeting rules:**
   - Women 25-45 prefer: higher colourfulness, medium-high complexity, warm tones
   - This means: use warm colour palette, expressive typography, generous imagery

4. **5 reference templates** that scored closest to the target coordinates:
   - Their section order
   - Their hero patterns
   - Their colour palettes
   - Their typography choices
   - Their overall character

**Ollama's job:** Write a detailed design brief for each of the 3 variations. NOT code. A brief. Like a creative director handing a spec to a developer.

**Example output from Ollama:**

```
VARIATION 1 — "Warm Clinical Luxury"
=====================================
Overall: Warm cream background, deep plum primary, rose gold accents.
         Serif headings (Playfair Display), clean sans body (Outfit).
         Soft 16px radius. Spacious 100px section padding.

Hero: Split layout. Left: stacked heading (4rem, serif, plum),
      subtext (1.1rem, sans, 60% opacity), dual CTAs (plum fill + outline).
      Right: Two overlapping images, rotated -3deg and +2deg,
      with soft box-shadow and 20px radius. Top image offset 40px up.
      Fade-in-up animation on load (0.8s ease-out, 40px travel).

Stats Strip: Plum background, cream text. 4-column grid.
      Numbers animate with counter (0 to value, 2s duration, easeOutExpo).
      Each column staggers 0.15s.

Services: Cream background. 3 cards with hover lift (translateY -8px,
      shadow increase). Image top with gradient overlay (transparent to plum 20%).
      Price in rose gold. 16px radius.
      Cards fade-in staggered on scroll (IntersectionObserver, 0.1s gap).

Testimonials: Soft plum tinted background (5% opacity).
      Single large testimonial with client photo rotated 3deg,
      hand-drawn SVG quote mark accent in rose gold.
      Text on left, image on right. Slides between 3 testimonials
      (CSS transition, 0.5s).

FAQ: Split layout. Left: massive serif heading "Have Questions?"
      Right: accordion items with plum background, cream text,
      + icon that rotates to × on open. Smooth height transition.

CTA: Full-width plum, cream text, centred. Large serif heading.
      Single pill button (cream fill, plum text, 999px radius).
      Subtle radial gradient glow behind heading.

Footer: Dark plum (#1a0a20), cream text at 60% opacity.
      4 columns. Social icons. Thin top border.

Animations throughout:
- All sections: fade-in-up on scroll entry (IntersectionObserver)
- Images: subtle parallax (translateY at 0.1× scroll speed)
- Nav: transparent → solid on scroll with backdrop-filter blur
- CTAs: hover scale 1.02 + shadow lift
- Cards: hover translateY -8px + enhanced shadow
```

**Why Ollama does this, not Claude:** It's local, it's free, it's fast. The design language library stays on the server. No tokens spent on brief generation. Claude API tokens are spent only on the actual code generation in Stage 3.

---

## Stage 3: GENERATION (Claude API — Sonnet)

Claude API receives:

1. **The design brief** from Ollama (the detailed spec above)
2. **The animation/interaction code library** (pre-built CSS/JS snippets)
3. **The business content** (name, services, staff, contact, images)
4. **The constraint rules:**
   - Output must be a single HTML file with embedded CSS and JS
   - Must be responsive (mobile, tablet, desktop)
   - Must pass WCAG 2.1 AA accessibility
   - Must use semantic HTML (nav, main, section, article, footer)
   - Must include all specified animations
   - Must use CSS custom properties for all colours and fonts
   - Images use placeholder URLs that get swapped later

**System prompt for Claude API:**

```
You are a senior frontend developer building a production website.
You receive a detailed design brief and business content.
Your output is a SINGLE complete HTML file with embedded <style> and <script>.

RULES:
- Every colour MUST use CSS custom properties (--primary, --accent, etc.)
- Every font MUST use CSS custom properties (--font-heading, --font-body)
- Use IntersectionObserver for scroll-triggered animations
- Use CSS transitions and transforms, not JavaScript animation libraries
- Parallax: CSS transform translateY with scroll listener
- Counter animations: requestAnimationFrame with easeOutExpo
- Responsive: mobile-first, breakpoints at 768px and 1024px
- Accessibility: semantic HTML, aria-labels, focus-visible, skip link
- No external dependencies except Google Fonts
- Output ONLY the HTML. No explanation. No markdown. Just the code.
```

**The animation/interaction library** is a pre-built reference of code patterns:

```css
/* Fade in up on scroll */
.reveal { opacity: 0; transform: translateY(40px); transition: opacity 0.8s ease, transform 0.8s ease; }
.reveal.visible { opacity: 1; transform: translateY(0); }

/* Parallax image */
.parallax-img { transition: transform 0.1s linear; }

/* Floating element */
@keyframes float { 0%,100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-20px) rotate(3deg); } }

/* Stagger children */
.stagger > *:nth-child(1) { transition-delay: 0s; }
.stagger > *:nth-child(2) { transition-delay: 0.1s; }
.stagger > *:nth-child(3) { transition-delay: 0.2s; }

/* Nav scroll effect */
.nav-scrolled { background: rgba(255,255,255,0.95); backdrop-filter: blur(12px); box-shadow: 0 2px 20px rgba(0,0,0,0.06); }

/* Curved section divider */
.curve-divider { position: relative; }
.curve-divider::after { content: ''; position: absolute; bottom: -1px; left: 0; right: 0; height: 80px; background: inherit; clip-path: ellipse(55% 100% at 50% 100%); }

/* Hover lift */
.hover-lift { transition: transform 0.3s ease, box-shadow 0.3s ease; }
.hover-lift:hover { transform: translateY(-8px); box-shadow: 0 20px 40px rgba(0,0,0,0.12); }

/* Counter animation */
function animateCounter(el, target, duration) {
  let start = 0; const startTime = performance.now();
  function ease(t) { return 1 - Math.pow(1 - t, 4); }
  function tick(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    el.textContent = Math.round(ease(progress) * target);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* Glassmorphism card */
.glass { background: rgba(255,255,255,0.1); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.15); }

/* Image overlap stack */
.img-stack { position: relative; }
.img-stack img:first-child { transform: rotate(-3deg); z-index: 1; }
.img-stack img:last-child { position: absolute; top: -40px; right: -40px; transform: rotate(2deg); z-index: 2; }

/* Marquee / ticker */
@keyframes marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
.marquee { overflow: hidden; }
.marquee-inner { display: flex; animation: marquee 30s linear infinite; }

/* Gradient text */
.gradient-text { background: linear-gradient(135deg, var(--primary), var(--accent)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }

/* 3D tilt on hover */
.tilt-hover { transition: transform 0.3s ease; perspective: 1000px; }
.tilt-hover:hover { transform: perspective(1000px) rotateX(2deg) rotateY(-2deg); }

/* Scroll progress bar */
.scroll-progress { position: fixed; top: 0; left: 0; height: 3px; background: var(--accent); z-index: 9999; transform-origin: left; }
```

Claude receives ALL of these patterns plus the brief. It assembles them into a complete page. The brief tells it exactly which patterns to use where.

---

## Stage 4: VALIDATION

Before returning the output:

1. **Render check** — Playwright on GP opens the generated HTML, screenshots it, confirms it renders (not blank/broken)
2. **Responsive check** — Screenshots at 1440px, 768px, 375px
3. **Basic accessibility** — Check for: lang attribute, viewport meta, skip link present, all images have alt, heading hierarchy (h1 → h2 → h3)
4. **Size check** — Total file under 500KB

If validation fails, the output goes back to Claude API with the error for a fix pass. Max 2 retries.

---

## Stage 5: OUTPUT

**Response:**
```json
{
  "status": "success",
  "business": "Rejuvenate Skin Experts",
  "industry": "aesthetics_clinic",
  "generated_at": "2026-03-22T18:30:00Z",
  "variations": [
    {
      "id": "v1-warm-clinical-luxury",
      "label": "Warm Clinical Luxury",
      "character": "Plum, cream, serif headings, spacious, elegant",
      "html": "<full HTML string>",
      "screenshots": {
        "desktop": "<base64 png>",
        "mobile": "<base64 png>"
      },
      "tokens_used": 4200,
      "cost_usd": 0.013
    },
    {
      "id": "v2-modern-minimal-trust",
      "label": "Modern Minimal Trust",
      "character": "...",
      "html": "...",
      "screenshots": { ... },
      "tokens_used": 3800,
      "cost_usd": 0.011
    },
    {
      "id": "v3-bold-editorial",
      "label": "Bold Editorial",
      "character": "...",
      "html": "...",
      "screenshots": { ... },
      "tokens_used": 4100,
      "cost_usd": 0.012
    }
  ],
  "total_cost_usd": 0.036,
  "generation_time_seconds": 45
}
```

---

## How It Gets Called

### From Growth Hub (Grant or Ambassador clicks "Generate Website"):
```
POST http://78.111.89.140:4100/api/generate
Body: { business data from MongoDB lead record }
```

### From Studio (future self-service):
```
POST http://78.111.89.140:4100/api/generate
Body: { business data from onboarding form }
```

### From CLI (testing):
```bash
curl -X POST http://78.111.89.140:4100/api/generate \
  -H "Content-Type: application/json" \
  -d '{"business_name":"Test Barber","industry":"barber",...}'
```

---

## Cost Per Website

| Stage | Provider | Cost |
|-------|----------|------|
| Intake | Local (GP) | Free |
| Design Brief | Ollama/Mistral (local) | Free |
| Generation (×3 variations) | Claude API Sonnet | ~$0.03-0.05 |
| Validation screenshots | Playwright (local) | Free |
| **Total per website** | | **~$0.04** |

At £100 per "Done For You" website, that's 99.96% margin.
At £29 for AI Build add-on, that's 99.86% margin.

---

## File Structure on GP

```
/opt/design-engine/
  ├── package.json
  ├── server.js                  ← Express API on port 4100
  ├── config.js                  ← API keys, model settings, paths
  ├── lib/
  │   ├── intake.js              ← Stage 1: validate, lookup industry
  │   ├── brief.js               ← Stage 2: Ollama design brief generation
  │   ├── generate.js            ← Stage 3: Claude API code generation
  │   ├── validate.js            ← Stage 4: Playwright render checks
  │   └── output.js              ← Stage 5: package response
  ├── data/
  │   ├── design_space.json      ← symlink to /opt/design-intelligence/output/design_space.json
  │   ├── animation-library.css  ← pre-built animation/interaction patterns
  │   ├── animation-library.js   ← pre-built JS interaction patterns
  │   └── industry-recipes.json  ← section order + content guidance per industry
  └── output/                    ← generated websites (temporary, cleaned daily)
```

---

## Dependencies

- **Node.js** (already on GP)
- **Express** (API framework)
- **Playwright** (already on GP — validation screenshots)
- **Ollama** (already on GP — running Mistral)
- **Claude API** (Anthropic, key in .env)
- **PM2** (already on GP — process management)

No new infrastructure. Everything is already on GP except the engine code itself.

---

## What Needs Building (in order)

1. **Animation/interaction library** — the CSS + JS pattern catalogue (the design vocabulary)
2. **Industry recipes** — section order + content templates per industry
3. **Brief generator** — Ollama prompt that reads design_space.json and writes briefs
4. **Code generator** — Claude API prompt that turns briefs into complete HTML
5. **Server wrapper** — Express API on port 4100
6. **Validation** — Playwright screenshot checks
7. **Integration** — Growth Hub "Generate Website" button calls the API

Steps 1-4 are the engine. Steps 5-7 are plumbing.

---

## What This Replaces

- Me trying to write design code (proven failure)
- Manual website building per client
- The UCL-plugin approach (components were too basic)
- Any dependency on a human designer in the generation loop

## What This Enables

- Growth Hub button → 3 websites in 45 seconds
- Studio.rezvo.app → self-service website builder
- Scale to 1000+ clients without touching a single design
- Every site looks different because the brief changes based on industry + audience + design space coordinates
