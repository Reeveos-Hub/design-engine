# ReeveOS AI Web Builder — Portal Integration Spec
## For Cursor: Part 2 of the Design Engine Build
## Date: 22 March 2026

---

## WHAT THIS IS

An AI-powered website builder embedded inside the ReeveOS business portal at `portal.rezvo.app`. It lives under **Web Manager → AI Builder** in the sidebar. It looks and works like Bolt.new / Lovable / Orchids — chat panel, live file tree, code editor, browser preview, terminal — but it's inside our dashboard, deploys to our infrastructure, and is powered by our Design Engine on the GP server.

This is NOT a standalone product. It's a feature inside the ReeveOS portal that business owners access from their dashboard.

---

## WHERE IT LIVES

### Portal Location
- Sidebar: **Web Manager** → **AI Builder** (new sub-item)
- Route: `/dashboard/web-manager/ai-builder`
- Component: `frontend/src/pages/dashboard/AIWebBuilder.jsx`
- Inside existing `DashboardLayout` (sidebar + topbar stay)

### Test Account
- Email: `levelambassador@gmail.com` (Rejuvenate test account)
- Business: Rejuvenate Skin Experts
- Use this account to test end-to-end

---

## THE LAYOUT (4 panels)

```
┌─────────────────────────────────────────────────────────────────┐
│ DashboardLayout (sidebar + topbar — EXISTING, DO NOT TOUCH)     │
├──────────┬──────────────────┬───────────────────────────────────┤
│          │                  │                                   │
│  CHAT    │   FILE TREE +    │        LIVE PREVIEW               │
│  PANEL   │   CODE EDITOR    │        (iframe)                   │
│          │                  │                                   │
│  Chat    │  ┌─ Files ─────┐ │   ┌─────────────────────────┐    │
│  history │  │ index.html  │ │   │                         │    │
│          │  │ style.css   │ │   │   Generated website     │    │
│  Prompt  │  │ script.js   │ │   │   renders here live     │    │
│  input   │  │ package.json│ │   │                         │    │
│          │  └─────────────┘ │   │                         │    │
│          │                  │   └─────────────────────────┘    │
│          │  ┌─ Editor ────┐ │                                   │
│          │  │ (CodeMirror)│ │   ┌─ Terminal (collapsible) ─┐   │
│          │  │             │ │   │ $ npm install            │   │
│          │  │             │ │   │ $ npm run dev            │   │
│          │  └─────────────┘ │   └──────────────────────────┘   │
├──────────┴──────────────────┴───────────────────────────────────┤
│  [Deploy to .reeveos.site]                    [Export Files]    │
└─────────────────────────────────────────────────────────────────┘
```

All 4 panels are **resizable** using drag handles. Terminal collapses/expands with a toggle button. The chat panel has a minimum width of 320px. The preview panel has a device-size toggle (desktop/tablet/mobile).

---

## NPM PACKAGES TO INSTALL

Add these to `frontend/package.json`:

### Core Runtime
```
@webcontainer/api          — In-browser Node.js runtime (OR use Sandpack as alternative)
```

### Code Editor
```
@uiw/react-codemirror      — React wrapper for CodeMirror 6
@codemirror/lang-javascript — JS/TS syntax
@codemirror/lang-html       — HTML syntax
@codemirror/lang-css        — CSS syntax
@codemirror/lang-json       — JSON syntax
@uiw/codemirror-theme-vscode — VS Code dark theme (matches our Rich Black brand)
```

### Terminal
```
@xterm/xterm               — Terminal emulator
@xterm/addon-fit           — Auto-resize terminal to container
@xterm/addon-web-links     — Clickable URLs in terminal output
```

### AI Streaming
```
ai                         — Vercel AI SDK core
@ai-sdk/react              — React hooks (useChat)
@ai-sdk/anthropic          — Claude provider
```

### Layout & UI
```
react-resizable-panels     — Draggable panel layout
react-markdown             — Render AI chat messages as markdown
rehype-raw                 — Allow raw HTML in markdown
rehype-sanitize            — Sanitize HTML in markdown
remark-gfm                 — GitHub-flavoured markdown (tables, strikethrough)
```

### Alternative to WebContainers (simpler, no commercial license needed)
```
@codesandbox/sandpack-react — Lighter browser sandbox (no terminal, no shell)
@codesandbox/sandpack-client — Lower-level Sandpack API
```

**Decision: WebContainers vs Sandpack**

For v1, use **Sandpack** — it's free (MIT licensed), lighter, and our websites are HTML/CSS/JS so we don't need full Node.js shell access. Sandpack gives us live preview with hot reload, file editing, and multi-file support. We can upgrade to WebContainers later for the full terminal experience.

If using Sandpack, we DON'T need xterm.js or @webcontainer/api. The terminal panel becomes a read-only log viewer instead.

---

## HOW IT CONNECTS TO THE DESIGN ENGINE

### The Flow

```
User types prompt in Chat Panel
    ↓
POST to Design Engine API on GP server
    http://78.111.89.140:4100/api/generate
    Body: { business_name, industry, prompt, ... }
    ↓
Design Engine runs:
    Stage 1: Intake (validate, lookup industry)
    Stage 2: Ollama writes design brief (FREE)
    Stage 3: Claude API generates HTML (PAID, ~£0.04)
    Stage 4: Playwright validates (FREE)
    Stage 5: Returns 3 variations with HTML + screenshots
    ↓
Portal receives response
    ↓
User picks a variation (shown as thumbnail cards)
    ↓
Selected HTML is loaded into Sandpack/WebContainers
    ↓
User sees live preview + can edit code + chat for refinements
    ↓
User clicks Deploy → POST to our backend
    ↓
Backend writes files to Caddy/Nginx serving *.reeveos.site
    ↓
Site is live at {business-slug}.reeveos.site
```

### For Chat-Based Refinements (After Initial Generation)

Once a variation is loaded, follow-up prompts go to Claude API directly (not the full Design Engine pipeline). The system prompt includes the current file contents + the user's request. Claude streams back updated files using the XML tag pattern:

```xml
<reeve_action type="file" filePath="index.html">
<!DOCTYPE html>
<html>
...complete updated file...
</html>
</reeve_action>
```

The streaming parser detects these tags, updates the file in Sandpack/WebContainers, and the preview hot-reloads.

### API Endpoint Format (Design Engine)

```
POST http://78.111.89.140:4100/api/generate

Request:
{
  "business_name": "Reeve Pay",
  "industry": "generic_business",
  "tagline": "Payments and business technology for UK high street",
  "services": [
    {"name": "Card Terminals", "price": "From 0.3%"},
    {"name": "EPOS Systems", "price": "From £29/mo"},
    {"name": "Website Builder", "price": "Included"},
    {"name": "Booking System", "price": "Included"}
  ],
  "phone": "0808 XXX XXXX",
  "email": "hello@reevepay.co.uk",
  "address": "Nottingham, UK"
}

Response:
{
  "status": "success",
  "variations": [
    {
      "id": "v1-abc123",
      "label": "Industry Standard",
      "html": "<!DOCTYPE html>...",
      "screenshots": { "desktop": "base64...", "mobile": "base64..." },
      "tokens_used": 4200
    },
    { ... v2 ... },
    { ... v3 ... }
  ],
  "total_tokens": 12400,
  "generation_time_ms": 38000
}
```

### For Chat Refinements (Direct Claude)

```
POST /api/ai-builder/chat  (new FastAPI endpoint on our VPS)

Request:
{
  "messages": [...conversation history...],
  "files": {
    "index.html": "<!DOCTYPE html>...",
    "style.css": "body { ... }",
    "script.js": "..."
  }
}

Response: SSE stream with XML action tags
```

---

## STREAMING PARSER

The key piece that makes the live file tree work. As Claude's response streams in token by token, this parser detects our custom XML tags and fires callbacks.

```javascript
class StreamingParser {
  constructor(callbacks) {
    this.callbacks = callbacks; // { onFileStart, onFileContent, onFileEnd, onShellCommand }
    this.buffer = '';
    this.currentFile = null;
    this.fileContent = '';
  }

  feed(chunk) {
    this.buffer += chunk;

    // Detect opening tag: <reeve_action type="file" filePath="...">
    const fileStartMatch = this.buffer.match(
      /<reeve_action\s+type="file"\s+filePath="([^"]+)">/
    );
    if (fileStartMatch && !this.currentFile) {
      this.currentFile = fileStartMatch[1];
      this.fileContent = '';
      this.callbacks.onFileStart(this.currentFile);
      this.buffer = this.buffer.slice(
        this.buffer.indexOf(fileStartMatch[0]) + fileStartMatch[0].length
      );
    }

    // If inside a file, accumulate content
    if (this.currentFile) {
      const endTag = '</reeve_action>';
      const endIdx = this.buffer.indexOf(endTag);
      if (endIdx !== -1) {
        this.fileContent += this.buffer.slice(0, endIdx);
        this.callbacks.onFileEnd(this.currentFile, this.fileContent);
        this.buffer = this.buffer.slice(endIdx + endTag.length);
        this.currentFile = null;
        this.fileContent = '';
      } else {
        this.fileContent += this.buffer;
        this.callbacks.onFileContent(this.currentFile, this.buffer);
        this.buffer = '';
      }
    }
  }
}
```

---

## FILE STRUCTURE (new files to create)

```
frontend/src/
  pages/dashboard/
    AIWebBuilder.jsx              ← Main page component (the 4-panel layout)
  
  components/ai-builder/
    ChatPanel.jsx                 ← Chat interface (message list + prompt input)
    FileTree.jsx                  ← File explorer showing project files
    CodeEditor.jsx                ← CodeMirror 6 wrapper
    PreviewPanel.jsx              ← iframe showing live site (or Sandpack preview)
    TerminalPanel.jsx             ← xterm.js terminal OR log viewer
    VariationPicker.jsx           ← Shows 3 generated options as thumbnail cards
    StreamingParser.js            ← XML tag parser for real-time file updates
    DeployButton.jsx              ← Deploy to .reeveos.site
    
  stores/
    aiBuilderStore.js             ← State: files, activeFile, messages, status, preview URL
```

### Backend (new endpoints on VPS)

```
backend/routes/dashboard/
  ai_builder.py                   ← New route file

  Endpoints:
    POST /api/dashboard/ai-builder/generate
      → Proxies to Design Engine on GP (78.111.89.140:4100/api/generate)
      → Adds tenant_id, business context from MongoDB
      → Returns 3 variations

    POST /api/dashboard/ai-builder/chat
      → Calls Claude API directly for refinements
      → Streams response via SSE
      → Includes current file contents in context

    POST /api/dashboard/ai-builder/deploy
      → Takes HTML files from the builder
      → Writes them to the tenant's website directory
      → Updates DNS/Caddy config if needed
      → Returns live URL

    GET /api/dashboard/ai-builder/projects
      → Lists saved builder projects for this tenant
      → Stored in MongoDB: ai_builder_projects collection

    PUT /api/dashboard/ai-builder/projects/{id}
      → Saves current project state (files, chat history)
```

---

## DEPLOYMENT PIPELINE

When user clicks "Deploy":

1. Frontend collects all files from Sandpack/WebContainers state
2. POST to `/api/dashboard/ai-builder/deploy` with file contents
3. Backend:
   a. Creates directory: `/var/www/sites/{business_slug}/`
   b. Writes all files (index.html, style.css, script.js, etc.)
   c. Adds Caddy/Nginx config for `{business_slug}.reeveos.site`
   d. If first deploy: creates DNS record via Cloudflare API
   e. Returns: `https://{business_slug}.reeveos.site`
4. Frontend shows success with live link + QR code

---

## BRANDING RULES

- Rich Black `#111111` for editor/terminal backgrounds
- Gold `#C9A84C` for active states, selected file, deploy button
- Gold Light `#F5EDD6` for hover states
- White `#FFFFFF` for text on dark backgrounds
- Figtree font throughout
- Monochrome icons only — NO emojis anywhere
- The builder sits inside DashboardLayout — DO NOT modify the sidebar or topbar
- CodeMirror uses VS Code Dark theme with Gold accent overrides
- Terminal uses Rich Black background with Gold cursor

---

## CHAT PANEL FEATURES

- **Message history** with user/AI bubbles
- **Streaming indicator** showing AI is typing
- **File badges** in AI responses ("Updated index.html", "Created style.css") — clickable to switch editor
- **Variation picker** appears after initial generation (3 thumbnail cards)
- **Prompt input** with Cmd/Ctrl+Enter to send
- **Suggested prompts** on empty state:
  - "Build a website for my {business_type}"
  - "Make the hero section more dramatic"
  - "Add a booking section"
  - "Change the colour scheme to match my brand"
- **Conversation persistence** — saved to MongoDB, reloaded on return

---

## FILE TREE FEATURES

- **Collapsible folders** with expand/collapse
- **Active file indicator** (Gold highlight on selected file)
- **File status icons**: 
  - Gold dot = currently being written by AI
  - Green dot = saved
  - No dot = unchanged
- **Click to open** in editor
- **Right-click context menu**: Rename, Delete, Duplicate

---

## PREVIEW PANEL FEATURES

- **Live iframe** rendering the generated site
- **Device toggle**: Desktop (1440px) | Tablet (768px) | Mobile (375px)
- **Refresh button** (force reload)
- **Open in new tab** button (opens preview URL in browser)
- **Loading state** with skeleton shimmer while generating

---

## WHAT THE AI SYSTEM PROMPT NEEDS

For refinement chat (after initial generation), the system prompt should:

1. Include ALL current file contents
2. Include the business context (name, industry, services)
3. Include the animation library (CSS + JS) from the Design Engine
4. Instruct the model to output COMPLETE files wrapped in `<reeve_action>` tags
5. Instruct the model to NEVER output partial files or diffs — always full content
6. Instruct the model to explain what it changed in plain English BEFORE the code

---

## BUILD ORDER

### Phase 1: Static Layout (no AI, just the panels)
1. Create route + page component
2. Add sidebar link under Web Manager
3. Build 4-panel layout with react-resizable-panels
4. Add CodeMirror with a hardcoded test file
5. Add preview iframe loading a hardcoded HTML string
6. Add chat panel UI (empty, no AI yet)
7. Verify it renders correctly inside DashboardLayout

### Phase 2: Design Engine Integration
1. Build the proxy endpoint on VPS (`/api/dashboard/ai-builder/generate`)
2. Wire chat panel to send prompt → proxy → Design Engine
3. Build VariationPicker component
4. Load selected variation into Sandpack/editor/preview
5. Test with "Build a website for Reeve Pay"

### Phase 3: Chat Refinements
1. Build the SSE chat endpoint on VPS (`/api/dashboard/ai-builder/chat`)
2. Build StreamingParser
3. Wire streaming to file tree + editor + preview updates
4. Test iterative refinement ("change the hero background", "add a testimonial section")

### Phase 4: Deploy
1. Build deploy endpoint on VPS
2. Build deploy button + success state
3. Test deployment to .reeveos.site
4. Add QR code generation for the live URL

### Phase 5: Polish
1. Project save/load (MongoDB persistence)
2. Chat history persistence
3. File status indicators
4. Device size toggle on preview
5. Error handling and retry logic

---

## SECURITY RULES

- All AI Builder endpoints require authenticated tenant token
- Files are written ONLY to the tenant's own directory — NEVER another tenant's
- API keys (Anthropic, Design Engine) stay on the backend — NEVER sent to frontend
- Generated HTML is sanitised before deployment (strip any script injections)
- Rate limit: max 10 generations per hour per tenant (prevent API abuse)
- All chat history encrypted at rest in MongoDB
- EXIF stripping on any uploaded images
- No PII in generated website content without explicit consent

---

## WHAT THE DESIGN ENGINE IS DOING (recap for context)

The Design Engine at `78.111.89.140:4100` (being built by Cursor right now) is the BACKEND for this feature. It:

1. Takes business data
2. Reads from the Design Intelligence Library (64,000+ design references)
3. Uses Ollama (Mistral, local, FREE) to write 3 design briefs
4. Uses Claude API (Sonnet, PAID ~£0.04 total) to generate 3 complete HTML websites
5. Uses Playwright to screenshot and validate each one
6. Returns 3 variations with HTML + screenshots

The portal's AI Builder is the FRONTEND for this engine. They connect via the proxy endpoint on our VPS.

---

## TOTAL NEW FILES

| File | Lines (est.) | Purpose |
|------|-------------|---------|
| `AIWebBuilder.jsx` | ~150 | Main page with panel layout |
| `ChatPanel.jsx` | ~200 | Chat UI with streaming |
| `FileTree.jsx` | ~100 | File explorer |
| `CodeEditor.jsx` | ~80 | CodeMirror wrapper |
| `PreviewPanel.jsx` | ~80 | iframe + device toggle |
| `TerminalPanel.jsx` | ~60 | Log viewer |
| `VariationPicker.jsx` | ~100 | 3-card thumbnail picker |
| `StreamingParser.js` | ~80 | XML action tag parser |
| `DeployButton.jsx` | ~60 | Deploy + success state |
| `aiBuilderStore.js` | ~120 | Zustand/nanostores state |
| `ai_builder.py` | ~200 | Backend routes |
| **Total** | **~1,230** | |

This is a focused, contained feature. It doesn't touch any existing portal code except adding one sidebar link and one route.
