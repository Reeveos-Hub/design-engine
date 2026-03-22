# AI Web Builder — Build Plan
## Instructions for Claude. Follow this EXACTLY. Don't deviate.
## Date: 22 March 2026

---

## WHAT WE'RE BUILDING

A full AI-powered website editor inside the ReeveOS portal at `/dashboard/ai-builder`. It's under Web Manager → AI Builder in the sidebar. It's a complete web manager replacement — not just a preview tool. Users chat with the AI, it builds and edits their website, they see changes live, they publish when ready. Full version history with rollback.

## COST RULES — NON-NEGOTIABLE

- **ZERO additional monthly costs.** No Fly.io, no E2B, no WebContainers license, no Sandpack hosting.
- The only variable cost is Claude API calls for generation/refinement.
- Everything runs on existing infrastructure: Reeve VPS (178.128.33.73), GP server (78.111.89.140), user's browser.
- Libraries must be MIT/Apache licensed and free. No proprietary runtimes.

## EXISTING INFRASTRUCTURE

- **Reeve VPS** (178.128.33.73): FastAPI backend, MongoDB, Nginx, the portal
- **GP Server** (78.111.89.140): Design Engine (port 4100), Ollama + Mistral, Playwright
- **MongoDB database**: `rezvo` on Reeve VPS
- **Frontend**: React + Vite + Tailwind, served from `/opt/rezvo-app/frontend/dist`
- **Theme**: Light theme. White backgrounds. Import from `config/theme.js`. NEVER dark theme except terminal.

## WHAT'S ALREADY PUSHED (and needs fixing)

These files exist in `Reeveos-Hub/portal` and need REWRITING, not new files:

| File | Status | What's wrong |
|------|--------|-------------|
| `frontend/src/pages/dashboard/AIWebBuilder.jsx` | EXISTS | Preview uses srcdoc (flashes on update), editor is fake `<pre>` tag, chat doesn't stream, no version history UI |
| `backend/routes/dashboard/ai_builder.py` | EXISTS | Chat endpoint doesn't stream (waits for full response), deploy writes to MongoDB but not disk |
| `frontend/src/App.jsx` | DONE | Route registered correctly |
| `frontend/src/components/layout/Sidebar.jsx` | DONE | Nav item registered correctly |
| `frontend/src/layouts/DashboardLayout.jsx` | DONE | Full-height exception added |
| `backend/routes/__init__.py` | DONE | Router imported |
| `backend/server.py` | DONE | Router included |

## THE 7 THINGS TO BUILD (in order)

### 1. PREVIEW ADAPTER (the iframe that doesn't flash)

**Problem:** Current code sets `srcDoc={html}` which destroys and recreates the iframe on every update. Screen flashes white.

**Solution:** Set srcDoc ONCE with a postMessage listener baked in. Push updates via postMessage. The iframe never reloads.

```jsx
// The INITIAL HTML set once via srcDoc
const PREVIEW_SHELL = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style id="__reeve_css"></style>
</head>
<body>
  <div id="__reeve_root"></div>
  <script>
    window.addEventListener('message', function(e) {
      if (!e.data || !e.data.__reeve) return;
      var d = e.data;
      if (d.type === 'full') {
        document.open();
        document.write(d.html);
        document.close();
      }
      if (d.type === 'css') {
        document.getElementById('__reeve_css').textContent = d.value;
      }
    });
    parent.postMessage({ __reeve: true, type: 'ready' }, '*');
  </script>
</body>
</html>`;
```

**How to update preview:**
```jsx
iframeRef.current.contentWindow.postMessage({
  __reeve: true,
  type: 'full',
  html: combinedHtml
}, '*');
```

**Debounce updates by 200ms** to avoid flooding.

**Sandbox attribute:** `sandbox="allow-scripts"` ONLY. Never `allow-same-origin`.

**Device toggle:** Use CSS transform scale on a wrapper div around the iframe. Set iframe width to target device width (375/768/1440), scale down to fit the panel.

**Adapter interface** for future expansion:
```javascript
// PreviewAdapter pattern — swap implementations without rewriting
const adapters = {
  srcdoc: { update(html) { /* postMessage */ }, destroy() {} },
  // Future: esbuild, remote container
};
```

### 2. SSE STREAMING CHAT (backend + frontend)

**Problem:** Current `/ai-builder/chat` endpoint waits for full Claude response. User stares at spinner for 30-60 seconds.

**Backend fix (ai_builder.py):**

Need `sse-starlette` package (already compatible with FastAPI). Check if VPS FastAPI version supports native SSE (0.135+). If not, use `sse-starlette`.

```python
from starlette.responses import StreamingResponse
from anthropic import AsyncAnthropic
import json

@router.post("/chat/stream")
async def chat_stream(body: dict = Body(...), ctx: TenantContext = Depends(verify_business_access)):
    """SSE endpoint — streams Claude tokens to frontend."""
    client = AsyncAnthropic()  # reads ANTHROPIC_API_KEY from env
    
    files = body.get("files", {})
    prompt = body.get("prompt", "")
    
    # Build context with current files
    file_context = ""
    for fname, content in files.items():
        file_context += f"\n--- {fname} ---\n{content}\n"
    
    system = f"""You are a web developer inside the ReeveOS AI Builder.
The user has a website with these files:
{file_context}

RULES:
- Output changed files wrapped in <reeve_action type="file" filePath="filename.ext">FULL CONTENT</reeve_action>
- Always output COMPLETE file content, never diffs
- Explain what you changed in 1-2 sentences BEFORE the file tags
- Keep existing design language unless asked to change it"""

    async def generate():
        async with client.messages.stream(
            model="claude-sonnet-4-20250514",
            max_tokens=16000,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            async for text in stream.text_stream:
                yield f"data: {json.dumps({'type': 'delta', 'text': text})}\n\n"
            
            final = await stream.get_final_message()
            yield f"data: {json.dumps({'type': 'done', 'usage': {'input': final.usage.input_tokens, 'output': final.usage.output_tokens}})}\n\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Prevents Nginx buffering
            "Connection": "keep-alive",
        }
    )
```

**CRITICAL Nginx config needed** for SSE to work:
```
# In the /api/ location block for portal.rezvo.app
proxy_buffering off;
proxy_http_version 1.1;
proxy_set_header Connection '';
```

**Frontend SSE consumption:**
```javascript
async function streamChat(prompt, files, onDelta, onDone, onError) {
  const token = localStorage.getItem('token');
  const response = await fetch('/api/ai-builder/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ prompt, files }),
  });
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line in buffer
    
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === 'delta') onDelta(data.text);
        if (data.type === 'done') onDone(data.usage);
      } catch {}
    }
  }
}
```

**Token buffering in React:**
```javascript
// Buffer tokens in a ref, flush to state via requestAnimationFrame
const tokenBufferRef = useRef('');
const rafRef = useRef(null);

function onDelta(text) {
  tokenBufferRef.current += text;
  if (!rafRef.current) {
    rafRef.current = requestAnimationFrame(() => {
      setStreamedText(prev => prev + tokenBufferRef.current);
      tokenBufferRef.current = '';
      rafRef.current = null;
    });
  }
}
```

### 3. STREAMING XML PARSER (state machine, not regex)

**Problem:** Current parser uses regex which breaks on split chunks and JS code containing `<`.

**Solution:** Character-by-character state machine.

States: `TEXT`, `TAG_OPEN`, `TAG_NAME`, `TAG_ATTRS`, `FILE_CONTENT`, `CLOSING_TAG`

```javascript
class StreamingParser {
  constructor({ onFileStart, onFileChunk, onFileEnd, onText }) {
    this.callbacks = { onFileStart, onFileChunk, onFileEnd, onText };
    this.state = 'TEXT';
    this.buffer = '';
    this.tagBuffer = '';
    this.currentFile = null;
    this.fileContent = '';
    this.closingTag = '</reeve_action>';
    this.closingIdx = 0;
  }
  
  feed(chunk) {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      
      if (this.state === 'TEXT') {
        if (ch === '<' && this.peekAhead(chunk, i, '<reeve_action')) {
          this.state = 'TAG_OPEN';
          this.tagBuffer = '<';
        } else {
          this.buffer += ch;
        }
      } else if (this.state === 'TAG_OPEN') {
        this.tagBuffer += ch;
        if (ch === '>') {
          // Parse filePath from tag
          const match = this.tagBuffer.match(/filePath="([^"]+)"/);
          if (match) {
            this.currentFile = match[1];
            this.fileContent = '';
            this.closingIdx = 0;
            this.callbacks.onFileStart(this.currentFile);
            this.state = 'FILE_CONTENT';
          } else {
            this.buffer += this.tagBuffer;
            this.state = 'TEXT';
          }
          this.tagBuffer = '';
        }
      } else if (this.state === 'FILE_CONTENT') {
        // Check for closing tag character by character
        if (ch === this.closingTag[this.closingIdx]) {
          this.closingIdx++;
          if (this.closingIdx === this.closingTag.length) {
            // Closing tag complete
            this.callbacks.onFileEnd(this.currentFile, this.fileContent);
            this.currentFile = null;
            this.closingIdx = 0;
            this.state = 'TEXT';
          }
        } else {
          // Not a closing tag — flush any partial match + current char
          if (this.closingIdx > 0) {
            this.fileContent += this.closingTag.slice(0, this.closingIdx);
            this.closingIdx = 0;
          }
          this.fileContent += ch;
          this.callbacks.onFileChunk(this.currentFile, ch);
        }
      }
    }
  }
  
  peekAhead(chunk, pos, target) {
    const remaining = chunk.slice(pos, pos + target.length);
    return remaining === target || target.startsWith(remaining);
  }
}
```

**Wire to file store:**
```javascript
const parser = new StreamingParser({
  onFileStart: (path) => {
    setFileStatuses(prev => ({ ...prev, [path]: 'writing' }));
    addTermLine(`Writing ${path}...`, T.gold);
  },
  onFileChunk: (path, chunk) => {
    // Optional: live code preview in editor
  },
  onFileEnd: (path, content) => {
    setFiles(prev => ({ ...prev, [path]: content }));
    setFileStatuses(prev => ({ ...prev, [path]: 'done' }));
    addTermLine(`✓ ${path} saved`, T.success);
  },
  onText: (text) => {
    // AI's explanation text — append to chat
    setStreamedText(prev => prev + text);
  },
});
```

### 4. VERSION CONTROL (MongoDB, zero cost)

**Collections on Reeve VPS (rezvo database):**

```
ai_builder_sites: {
  _id, business_id, slug, current_version, files: {},
  status: 'draft'|'live', updated_at, created_at
}

ai_builder_versions: {
  _id, business_id, version: Number, files: {},
  message: String,  // "Changed hero heading"
  deployed_at: Date, deployed_by: String
}

ai_builder_chat_history: {
  _id, business_id, messages: [{role, text, files?, timestamp}],
  updated_at
}
```

**Backend endpoints (add to ai_builder.py):**

```python
@router.get("/versions")
async def list_versions(ctx: TenantContext = Depends(verify_business_access)):
    """List all version snapshots for this tenant."""
    db = get_database()
    versions = []
    cursor = db.ai_builder_versions.find(
        {"business_id": str(ctx.business_id)}
    ).sort("version", -1).limit(50)
    async for v in cursor:
        v["_id"] = str(v["_id"])
        versions.append({
            "version": v["version"],
            "message": v.get("message", ""),
            "deployed_at": v["deployed_at"].isoformat() if v.get("deployed_at") else None,
            "file_count": len(v.get("files", {})),
        })
    return {"versions": versions}

@router.post("/rollback/{version}")
async def rollback_to_version(
    version: int,
    ctx: TenantContext = Depends(verify_business_access)
):
    """Restore files from a previous version."""
    db = get_database()
    snapshot = await db.ai_builder_versions.find_one({
        "business_id": str(ctx.business_id),
        "version": version,
    })
    if not snapshot:
        raise HTTPException(404, f"Version {version} not found")
    
    # Update current site with old files
    await db.ai_builder_sites.update_one(
        {"business_id": str(ctx.business_id)},
        {"$set": {
            "files": snapshot["files"],
            "current_version": version,
            "updated_at": datetime.utcnow(),
            "status": "draft",  # Rollback puts into draft — must re-publish
        }}
    )
    return {"status": "rolled_back", "version": version}
```

**Frontend version history panel:**
- Collapsible sidebar (or dropdown in toolbar) showing version list
- Each version shows: version number, message, timestamp, file count
- Click to preview (loads into editor without publishing)
- "Restore this version" button → calls rollback endpoint → reloads files
- "Publish" makes it live

### 5. REAL CODE EDITOR (CodeMirror 6)

**npm packages to install:**
```
@uiw/react-codemirror
@codemirror/lang-html
@codemirror/lang-css
@codemirror/lang-javascript
@codemirror/lang-json
@codemirror/theme-one-dark
```

**Multi-file tab state:**
```javascript
// Store EditorState objects per file — preserves undo/redo/cursor per tab
const editorStatesRef = useRef(new Map());

function switchFile(newPath) {
  // Save current state
  if (activeFile && editorViewRef.current) {
    editorStatesRef.current.set(activeFile, editorViewRef.current.state);
  }
  setActiveFile(newPath);
}
```

**Read-only during AI generation:**
```javascript
// Use Compartment to toggle read-only
import { Compartment } from '@codemirror/state';
const readOnlyComp = new Compartment();

// Toggle: view.dispatch({ effects: readOnlyComp.reconfigure(EditorState.readOnly.of(true)) })
```

**React 18 StrictMode guard:**
```javascript
const mountedRef = useRef(false);
useEffect(() => {
  if (mountedRef.current) return; // Prevent double mount
  mountedRef.current = true;
  // ... create editor
  return () => { mountedRef.current = false; view.destroy(); };
}, []);
```

### 6. DEPLOY PIPELINE (write to disk, not just MongoDB)

**Backend deploy endpoint needs to actually write files:**

```python
import aiofiles
import os

@router.post("/deploy")
async def deploy_website(body: dict = Body(...), ctx: TenantContext = Depends(verify_business_access)):
    db = get_database()
    files = body.get("files", {})
    if not files:
        raise HTTPException(400, "No files to deploy")
    
    business = await db.businesses.find_one({"_id": ctx.business_id})
    slug = business.get("slug", str(ctx.business_id))
    
    # Atomic deploy: write to timestamped dir, symlink swap
    deploy_base = f"/var/www/sites/{slug}"
    release_dir = f"{deploy_base}/releases/{int(datetime.utcnow().timestamp())}"
    current_link = f"{deploy_base}/current"
    
    os.makedirs(release_dir, exist_ok=True)
    
    for filename, content in files.items():
        # Sanitize filename — prevent path traversal
        safe_name = os.path.basename(filename)
        filepath = os.path.join(release_dir, safe_name)
        async with aiofiles.open(filepath, 'w') as f:
            await f.write(content)
    
    # Atomic symlink swap
    tmp_link = f"{deploy_base}/current_tmp"
    os.symlink(release_dir, tmp_link)
    os.rename(tmp_link, current_link)  # atomic on Linux
    
    # Save version snapshot
    existing = await db.ai_builder_versions.find_one(
        {"business_id": str(ctx.business_id)}, sort=[("version", -1)]
    )
    next_version = (existing.get("version", 0) + 1) if existing else 1
    
    await db.ai_builder_versions.insert_one({
        "business_id": str(ctx.business_id),
        "version": next_version,
        "files": files,
        "message": body.get("message", f"Version {next_version}"),
        "deployed_at": datetime.utcnow(),
        "deployed_by": str(ctx.user_id),
    })
    
    await db.ai_builder_sites.update_one(
        {"business_id": str(ctx.business_id)},
        {"$set": {
            "files": files, "slug": slug,
            "current_version": next_version,
            "updated_at": datetime.utcnow(), "status": "live",
        }},
        upsert=True,
    )
    
    # Clean old releases (keep last 5)
    releases_dir = f"{deploy_base}/releases"
    if os.path.exists(releases_dir):
        releases = sorted(os.listdir(releases_dir))
        for old in releases[:-5]:
            import shutil
            shutil.rmtree(os.path.join(releases_dir, old), ignore_errors=True)
    
    return {
        "status": "deployed",
        "url": f"https://{slug}.reeveos.site",
        "version": next_version,
    }
```

**Nginx config for serving deployed sites** (add to *.reeveos.site server block):
```
location / {
    root /var/www/sites/$host/current;
    try_files $uri $uri/ /index.html;
}
```

### 7. UI LAYOUT

**Default view: Chat + Preview (Lovable-style for non-technical users)**

```
┌───────────────────────────────────────────────────────────┐
│ Toolbar: [AI Builder] [Beta]          [v3 live] [Publish] │
├──────────┬────────────────────────────────────────────────┤
│          │                                                │
│  CHAT    │         LIVE PREVIEW                           │
│  PANEL   │         (iframe, postMessage updates)          │
│          │                                                │
│  History │         Device toggle: [D] [T] [M]             │
│  Messages│                                                │
│  Input   │                                                │
│          │                                                │
├──────────┤  ┌─ Collapsible terminal log ─────────────┐   │
│ [Code ▸] │  │ $ generating... ✓ index.html saved     │   │
│ [Hist ▸] │  └────────────────────────────────────────┘   │
└──────────┴────────────────────────────────────────────────┘
```

**Expanded view (toggle "Code" button to show developer panels):**
```
┌───────────────────────────────────────────────────────────────────┐
│ Toolbar                                                           │
├──────────┬──────────────────┬─────────────────────────────────────┤
│  CHAT    │  FILE TREE +     │       LIVE PREVIEW                  │
│          │  CODE EDITOR     │                                     │
│          │  (CodeMirror 6)  │                                     │
│          │                  │                                     │
├──────────┤──────────────────┤  ┌─ Terminal log ──────────────┐   │
│          │                  │  │                              │   │
└──────────┴──────────────────┴──┴──────────────────────────────┘   │
```

**"History" button opens version history panel** — sliding drawer from the right showing all versions with rollback buttons.

---

## DEPENDENCIES TO INSTALL

### Frontend (npm):
```
@uiw/react-codemirror          — Code editor
@codemirror/lang-html           — HTML syntax (includes nested CSS/JS)
@codemirror/lang-css            — CSS syntax
@codemirror/lang-javascript     — JS syntax
@codemirror/lang-json           — JSON syntax
@codemirror/theme-one-dark      — Dark theme for editor panel
react-resizable-panels          — Draggable panel layout
```

### Backend (pip):
```
anthropic                       — AsyncAnthropic for streaming (CHECK if already installed)
aiofiles                        — Async file writing for deploy
```

**CHECK FIRST:** What's already in requirements.txt. Don't add duplicates.

---

## BUILD ORDER — ONE PIECE AT A TIME

1. **Preview Adapter** — rewrite the iframe to use postMessage. Test: changing files doesn't flash the preview.
2. **SSE Streaming Backend** — add `/chat/stream` endpoint. Test: curl with SSE headers shows streaming tokens.
3. **SSE Frontend Consumer** — wire chat to use fetch + ReadableStream. Test: typing shows in chat as AI generates.
4. **Streaming Parser** — add the state machine parser. Test: AI response with `<reeve_action>` tags updates files.
5. **CodeMirror Editor** — replace `<pre>` with real editor. Test: can type, syntax highlighting works, tabs switch files.
6. **Version History** — add backend endpoints + frontend UI. Test: versions list shows, rollback restores files.
7. **Deploy Pipeline** — fix deploy to write to disk + symlink swap. Test: file appears at slug.reeveos.site.

**RULE: Do NOT start step N+1 until step N is tested and committed.**

---

## FILES TO MODIFY

| File | What changes |
|------|-------------|
| `frontend/src/pages/dashboard/AIWebBuilder.jsx` | REWRITE — postMessage preview, streaming chat, CodeMirror, version history |
| `backend/routes/dashboard/ai_builder.py` | ADD — /chat/stream SSE endpoint, /versions, /rollback/{version}, fix /deploy to write to disk |
| `frontend/package.json` | ADD — CodeMirror packages, react-resizable-panels |
| `backend/requirements.txt` | CHECK — anthropic, aiofiles (add if missing) |
| `nginx.conf` (on VPS) | ADD — proxy_buffering off for SSE, *.reeveos.site site serving |

---

## THINGS THAT WILL BREAK IF I FORGET

1. **Nginx buffers SSE** — must add `proxy_buffering off` or tokens arrive in bursts
2. **React 18 StrictMode double-mount** — guard CodeMirror and iframe init with refs
3. **api.js returns raw JSON not {data}** — use `res.X` not `res.data.X`
4. **API paths: frontend calls `/ai-builder/X`** — Nginx strips `/api/`, FastAPI prefix is `/ai-builder`
5. **VPS Python is 3.10** — no triple-quote f-strings, use concatenation
6. **Always `rm -rf dist` before building** — Vite cache causes stale bundles
7. **sandbox="allow-scripts" ONLY** — never add allow-same-origin
8. **Debounce preview updates by 200ms** — or postMessage floods the iframe
9. **Token buffer in useRef + requestAnimationFrame** — or React re-renders per token and UI locks
10. **Atomic symlink swap for deploy** — `os.symlink()` then `os.rename()`, not `ln -sf`
