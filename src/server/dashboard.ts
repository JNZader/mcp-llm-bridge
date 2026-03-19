/**
 * Admin Dashboard — inline HTML served at GET /
 *
 * Single-page admin interface for the LLM Gateway. Uses vanilla JS
 * and fetch() calls to the existing /v1/* API endpoints.
 * No external dependencies — everything is inline.
 */

export function dashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LLM Gateway — Admin</title>
  <style>
    /* ── Reset & Base ────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:         #0d1117;
      --bg-card:    #161b22;
      --bg-input:   #0d1117;
      --border:     #30363d;
      --border-hl:  #484f58;
      --text:       #e6edf3;
      --text-dim:   #8b949e;
      --accent:     #a855f7;
      --accent-dim: #7c3aed;
      --green:      #3fb950;
      --red:        #f85149;
      --orange:     #d29922;
      --font-mono:  'SF Mono', 'Cascadia Code', 'JetBrains Mono', Consolas, monospace;
      --font-sans:  -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      --radius:     8px;
    }

    body {
      font-family: var(--font-sans);
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
    }

    /* ── Layout ──────────────────────────────────── */
    .container {
      max-width: 1080px;
      margin: 0 auto;
      padding: 24px 20px;
    }

    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 32px;
    }

    header h1 {
      font-size: 1.5rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    header h1 .icon { font-size: 1.3rem; }

    .version {
      font-size: 0.75rem;
      color: var(--accent);
      background: rgba(168, 85, 247, 0.12);
      padding: 2px 8px;
      border-radius: 12px;
      font-family: var(--font-mono);
    }

    .health-badge {
      font-size: 0.8rem;
      padding: 4px 12px;
      border-radius: 12px;
      font-weight: 500;
    }

    .health-badge.ok { color: var(--green); background: rgba(63, 185, 80, 0.12); }
    .health-badge.err { color: var(--red); background: rgba(248, 81, 73, 0.12); }

    /* ── Sections ─────────────────────────────────── */
    section {
      margin-bottom: 36px;
    }

    section h2 {
      font-size: 1.1rem;
      font-weight: 600;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border);
      color: var(--text);
    }

    /* ── Cards / Panels ──────────────────────────── */
    .card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
    }

    /* ── Table ────────────────────────────────────── */
    .table-wrap {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }

    th, td {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
    }

    th {
      color: var(--text-dim);
      font-weight: 500;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    td { color: var(--text); }

    tr:last-child td { border-bottom: none; }

    td code {
      font-family: var(--font-mono);
      font-size: 0.82rem;
      background: rgba(168, 85, 247, 0.08);
      padding: 2px 6px;
      border-radius: 4px;
    }

    .empty-msg {
      color: var(--text-dim);
      text-align: center;
      padding: 24px;
      font-style: italic;
    }

    /* ── Filter bar ──────────────────────────────── */
    .filter-bar {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-bottom: 12px;
      font-size: 0.85rem;
    }

    .filter-bar label {
      color: var(--text-dim);
      font-weight: 500;
      font-size: 0.78rem;
    }

    /* ── Buttons ──────────────────────────────────── */
    button, .btn {
      font-family: var(--font-sans);
      font-size: 0.85rem;
      font-weight: 500;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 7px 14px;
      cursor: pointer;
      transition: all 0.15s ease;
      color: var(--text);
      background: var(--bg-card);
    }

    button:hover { border-color: var(--border-hl); background: #1c2129; }

    .btn-primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    .btn-primary:hover { background: var(--accent-dim); border-color: var(--accent-dim); }

    .btn-danger {
      color: var(--red);
      border-color: transparent;
      background: transparent;
      padding: 4px 8px;
      font-size: 0.8rem;
    }
    .btn-danger:hover { background: rgba(248, 81, 73, 0.12); }

    .btn-sm { padding: 4px 10px; font-size: 0.8rem; }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* ── Forms ────────────────────────────────────── */
    .form-row {
      display: flex;
      gap: 10px;
      align-items: flex-end;
      flex-wrap: wrap;
      margin-top: 16px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .form-group label {
      font-size: 0.78rem;
      color: var(--text-dim);
      font-weight: 500;
    }

    input, select, textarea {
      font-family: var(--font-sans);
      font-size: 0.875rem;
      background: var(--bg-input);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 10px;
      outline: none;
      transition: border-color 0.15s ease;
    }

    input:focus, select:focus, textarea:focus {
      border-color: var(--accent);
    }

    select { min-width: 140px; }

    textarea {
      width: 100%;
      resize: vertical;
      min-height: 80px;
      font-family: var(--font-mono);
      font-size: 0.85rem;
      line-height: 1.5;
    }

    /* ── Project badge ───────────────────────────── */
    .project-badge {
      display: inline-block;
      font-family: var(--font-mono);
      font-size: 0.75rem;
      padding: 1px 6px;
      border-radius: 4px;
      border: 1px solid var(--border);
    }

    .project-badge.global {
      color: var(--text-dim);
      background: transparent;
    }

    .project-badge.scoped {
      color: var(--accent);
      background: rgba(168, 85, 247, 0.08);
      border-color: rgba(168, 85, 247, 0.3);
    }

    /* ── Provider cards ───────────────────────────── */
    .providers-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 12px;
    }

    .provider-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .provider-card .name {
      font-weight: 600;
      font-size: 0.95rem;
    }

    .provider-card .meta {
      font-size: 0.78rem;
      color: var(--text-dim);
      display: flex;
      gap: 12px;
    }

    .status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 4px;
      vertical-align: middle;
    }

    .status-dot.on  { background: var(--green); box-shadow: 0 0 6px rgba(63, 185, 80, 0.4); }
    .status-dot.off { background: var(--red); }

    /* ── Models list ──────────────────────────────── */
    .models-group {
      margin-bottom: 16px;
    }

    .models-group h3 {
      font-size: 0.9rem;
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--accent);
    }

    .model-chip {
      display: inline-block;
      font-family: var(--font-mono);
      font-size: 0.8rem;
      background: rgba(168, 85, 247, 0.08);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 4px 10px;
      margin: 0 6px 6px 0;
      color: var(--text);
    }

    /* ── Test section ─────────────────────────────── */
    .test-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .test-controls {
      display: flex;
      gap: 10px;
      align-items: flex-end;
      flex-wrap: wrap;
    }

    .response-area {
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 16px;
      font-family: var(--font-mono);
      font-size: 0.85rem;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
      min-height: 60px;
      display: none;
    }

    .response-area.visible { display: block; }

    .response-meta {
      display: flex;
      gap: 16px;
      font-size: 0.78rem;
      color: var(--text-dim);
      margin-top: 8px;
      display: none;
    }

    .response-meta.visible { display: flex; }

    .response-meta span {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    /* ── Spinner ──────────────────────────────────── */
    .spinner {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid var(--border);
      border-top: 2px solid var(--accent);
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      vertical-align: middle;
      margin-right: 6px;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Toast notification ───────────────────────── */
    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      padding: 12px 20px;
      border-radius: var(--radius);
      font-size: 0.85rem;
      font-weight: 500;
      color: #fff;
      z-index: 1000;
      opacity: 0;
      transform: translateY(10px);
      transition: all 0.25s ease;
      pointer-events: none;
    }

    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }

    .toast.success { background: var(--green); }
    .toast.error   { background: var(--red); }

    /* ── Responsive ───────────────────────────────── */
    @media (max-width: 640px) {
      .container { padding: 16px 12px; }
      .form-row { flex-direction: column; }
      .form-group { width: 100%; }
      .test-controls { flex-direction: column; }
      .test-controls .form-group { width: 100%; }
      header { flex-direction: column; gap: 12px; align-items: flex-start; }
    }
  </style>
</head>
<body>
  <div class="container">

    <!-- ── External dashboard banner ──────────── -->
    <div style="
      background: rgba(168, 85, 247, 0.08);
      border: 1px solid rgba(168, 85, 247, 0.25);
      border-radius: 8px;
      padding: 10px 16px;
      margin-bottom: 20px;
      font-size: 0.85rem;
      color: var(--text-dim);
    ">
      \uD83D\uDCF1 This dashboard is also available at
      <a href="https://jnzader.github.io/mcp-llm-bridge/"
         target="_blank" rel="noopener"
         style="color: var(--accent); text-decoration: none; font-weight: 500;">
        jnzader.github.io/mcp-llm-bridge/
      </a>
    </div>

    <!-- ── Header ──────────────────────────────── -->
    <header>
      <h1>
        <span class="icon">\u26A1</span> LLM Gateway
        <span class="version">v0.2.0</span>
      </h1>
      <span id="health" class="health-badge">checking\u2026</span>
    </header>

    <!-- ── Credentials ────────────────────────── -->
    <section id="sec-credentials">
      <h2>\uD83D\uDD10 Credentials</h2>
      <div class="card">
        <div class="filter-bar">
          <label for="cred-filter-project">Filter by project:</label>
          <select id="cred-filter-project" onchange="loadCredentials()">
            <option value="">All</option>
            <option value="_global">_global</option>
            <option value="ghagga">ghagga</option>
            <option value="md-evals">md-evals</option>
            <option value="repoforge">repoforge</option>
          </select>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Key Name</th>
                <th>Project</th>
                <th>Value</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="cred-rows">
              <tr><td colspan="6" class="empty-msg">Loading\u2026</td></tr>
            </tbody>
          </table>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="cred-provider">Provider</label>
            <select id="cred-provider">
              <option value="anthropic">anthropic</option>
              <option value="openai">openai</option>
              <option value="groq">groq</option>
              <option value="openrouter">openrouter</option>
              <option value="google">google</option>
              <option value="github-copilot">github-copilot</option>
            </select>
          </div>
          <div class="form-group">
            <label for="cred-name">Key Name</label>
            <input type="text" id="cred-name" placeholder="default" value="default" style="width:120px">
          </div>
          <div class="form-group">
            <label for="cred-project">Project</label>
            <select id="cred-project">
              <option value="_global">_global (shared)</option>
              <option value="ghagga">ghagga</option>
              <option value="md-evals">md-evals</option>
              <option value="repoforge">repoforge</option>
              <option value="__custom__">custom\u2026</option>
            </select>
          </div>
          <div class="form-group" id="cred-custom-project-group" style="display:none">
            <label for="cred-custom-project">Custom Project</label>
            <input type="text" id="cred-custom-project" placeholder="my-project" style="width:140px">
          </div>
          <div class="form-group">
            <label for="cred-key">API Key</label>
            <input type="password" id="cred-key" placeholder="sk-\u2026" style="width:280px">
          </div>
          <button class="btn-primary" onclick="addCredential()">Add Key</button>
        </div>
      </div>
    </section>

    <!-- ── Auth Files ─────────────────────────── -->
    <section id="sec-files">
      <h2>\uD83D\uDCC1 Auth Files</h2>
      <div class="card">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>File Name</th>
                <th>Project</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="file-rows">
              <tr><td colspan="5" class="empty-msg">Loading\u2026</td></tr>
            </tbody>
          </table>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label for="file-provider">Provider</label>
            <select id="file-provider">
              <option value="opencode">opencode</option>
            </select>
          </div>
          <div class="form-group">
            <label for="file-input">File</label>
            <input type="file" id="file-input" accept=".json" style="font-size:0.85rem">
          </div>
          <div class="form-group">
            <label for="file-project">Project</label>
            <select id="file-project">
              <option value="_global">_global (shared)</option>
              <option value="ghagga">ghagga</option>
              <option value="md-evals">md-evals</option>
              <option value="repoforge">repoforge</option>
              <option value="__custom__">custom\u2026</option>
            </select>
          </div>
          <div class="form-group" id="file-custom-project-group" style="display:none">
            <label for="file-custom-project">Custom Project</label>
            <input type="text" id="file-custom-project" placeholder="my-project" style="width:140px">
          </div>
          <button class="btn-primary" onclick="uploadFile()">Upload</button>
        </div>
      </div>
    </section>

    <!-- ── Providers ──────────────────────────── -->
    <section id="sec-providers">
      <h2>\uD83D\uDCE1 Providers</h2>
      <div id="providers-grid" class="providers-grid">
        <div class="empty-msg">Loading\u2026</div>
      </div>
    </section>

    <!-- ── Models ─────────────────────────────── -->
    <section id="sec-models">
      <h2>\uD83E\uDDE0 Models</h2>
      <div id="models-list" class="card">
        <div class="empty-msg">Loading\u2026</div>
      </div>
    </section>

    <!-- ── Test ───────────────────────────────── -->
    <section id="sec-test">
      <h2>\uD83E\uDDEA Test Generation</h2>
      <div class="card">
        <div class="test-form">
          <div class="form-group">
            <label for="test-prompt">Prompt</label>
            <textarea id="test-prompt" placeholder="Enter a prompt to test\u2026" rows="3"></textarea>
          </div>
          <div class="test-controls">
            <div class="form-group">
              <label for="test-provider">Provider (optional)</label>
              <select id="test-provider">
                <option value="">auto</option>
              </select>
            </div>
            <div class="form-group">
              <label for="test-model">Model (optional)</label>
              <select id="test-model">
                <option value="">auto</option>
              </select>
            </div>
            <div class="form-group">
              <label for="test-project">Project (optional)</label>
              <select id="test-project">
                <option value="">none</option>
                <option value="_global">_global</option>
                <option value="ghagga">ghagga</option>
                <option value="md-evals">md-evals</option>
                <option value="repoforge">repoforge</option>
              </select>
            </div>
            <div class="form-group">
              <label for="test-tokens">Max Tokens</label>
              <input type="number" id="test-tokens" placeholder="1024" value="1024" style="width:90px">
            </div>
            <button class="btn-primary" id="test-btn" onclick="runTest()">Generate</button>
          </div>
          <div id="test-response" class="response-area"></div>
          <div id="test-meta" class="response-meta">
            <span id="meta-provider">\u2014</span>
            <span id="meta-model">\u2014</span>
            <span id="meta-tokens">\u2014</span>
          </div>
        </div>
      </div>
    </section>

  </div>

  <!-- Toast -->
  <div id="toast" class="toast"></div>

  <script>
    // ── API helpers ─────────────────────────────

    async function api(path, opts = {}) {
      const res = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...opts,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      return data;
    }

    function toast(msg, type = 'success') {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.className = 'toast ' + type + ' show';
      setTimeout(() => el.classList.remove('show'), 3000);
    }

    function escHtml(s) {
      const d = document.createElement('div');
      d.textContent = s;
      return d.innerHTML;
    }

    function fmtDate(iso) {
      if (!iso) return '\u2014';
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function projectBadge(project) {
      const isGlobal = project === '_global';
      const cls = isGlobal ? 'global' : 'scoped';
      return '<span class="project-badge ' + cls + '">' + escHtml(project) + '</span>';
    }

    // ── Custom project toggle ───────────────────

    document.getElementById('cred-project').addEventListener('change', function() {
      const customGroup = document.getElementById('cred-custom-project-group');
      customGroup.style.display = this.value === '__custom__' ? 'flex' : 'none';
    });

    // ── Credentials ─────────────────────────────

    async function loadCredentials() {
      try {
        const filterProject = document.getElementById('cred-filter-project').value;
        const url = filterProject ? '/v1/credentials?project=' + encodeURIComponent(filterProject) : '/v1/credentials';
        const { credentials } = await api(url);
        const tbody = document.getElementById('cred-rows');
        if (!credentials || credentials.length === 0) {
          tbody.innerHTML = '<tr><td colspan="6" class="empty-msg">No credentials stored. Add one below.</td></tr>';
          return;
        }
        tbody.innerHTML = credentials.map(c => \`
          <tr>
            <td><code>\${escHtml(c.provider)}</code></td>
            <td><code>\${escHtml(c.keyName)}</code></td>
            <td>\${projectBadge(c.project || '_global')}</td>
            <td><code>\${escHtml(c.maskedValue)}</code></td>
            <td>\${fmtDate(c.createdAt)}</td>
            <td><button class="btn-danger btn-sm" onclick="deleteCredential(\${c.id}, '\${escHtml(c.provider)}')">\u2715 Delete</button></td>
          </tr>
        \`).join('');
      } catch (e) {
        document.getElementById('cred-rows').innerHTML =
          '<tr><td colspan="6" class="empty-msg" style="color:var(--red)">Failed to load: ' + escHtml(e.message) + '</td></tr>';
      }
    }

    async function addCredential() {
      const provider = document.getElementById('cred-provider').value;
      const keyName  = document.getElementById('cred-name').value.trim() || 'default';
      const apiKey   = document.getElementById('cred-key').value.trim();

      const projectSelect = document.getElementById('cred-project').value;
      const project = projectSelect === '__custom__'
        ? (document.getElementById('cred-custom-project').value.trim() || '_global')
        : projectSelect;

      if (!apiKey) {
        toast('API key is required', 'error');
        return;
      }

      try {
        await api('/v1/credentials', {
          method: 'POST',
          body: JSON.stringify({ provider, keyName, apiKey, project }),
        });
        document.getElementById('cred-key').value = '';
        toast('Credential added for ' + provider + ' (' + project + ')');
        await refreshAll();
      } catch (e) {
        toast('Failed: ' + e.message, 'error');
      }
    }

    async function deleteCredential(id, provider) {
      if (!confirm('Delete credential for "' + provider + '"?')) return;
      try {
        await api('/v1/credentials/' + id, { method: 'DELETE' });
        toast('Credential deleted');
        await refreshAll();
      } catch (e) {
        toast('Failed: ' + e.message, 'error');
      }
    }

    // ── Auth Files ───────────────────────────────

    document.getElementById('file-project').addEventListener('change', function() {
      const customGroup = document.getElementById('file-custom-project-group');
      customGroup.style.display = this.value === '__custom__' ? 'flex' : 'none';
    });

    async function loadFiles() {
      try {
        const { files } = await api('/v1/files');
        const tbody = document.getElementById('file-rows');
        if (!files || files.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="empty-msg">No auth files stored. Upload one below.</td></tr>';
          return;
        }
        tbody.innerHTML = files.map(f => \`
          <tr>
            <td><code>\${escHtml(f.provider)}</code></td>
            <td><code>\${escHtml(f.fileName)}</code></td>
            <td>\${projectBadge(f.project || '_global')}</td>
            <td>\${fmtDate(f.createdAt)}</td>
            <td><button class="btn-danger btn-sm" onclick="deleteFile(\${f.id}, '\${escHtml(f.fileName)}')">\u2715 Delete</button></td>
          </tr>
        \`).join('');
      } catch (e) {
        document.getElementById('file-rows').innerHTML =
          '<tr><td colspan="5" class="empty-msg" style="color:var(--red)">Failed to load: ' + escHtml(e.message) + '</td></tr>';
      }
    }

    async function uploadFile() {
      const provider = document.getElementById('file-provider').value;
      const fileInput = document.getElementById('file-input');
      const file = fileInput.files[0];

      const projectSelect = document.getElementById('file-project').value;
      const project = projectSelect === '__custom__'
        ? (document.getElementById('file-custom-project').value.trim() || '_global')
        : projectSelect;

      if (!file) {
        toast('Select a file first', 'error');
        return;
      }

      try {
        const content = await file.text();
        await api('/v1/files', {
          method: 'POST',
          body: JSON.stringify({ provider, fileName: file.name, content, project }),
        });
        fileInput.value = '';
        toast('File uploaded for ' + provider + ' (' + project + ')');
        await refreshAll();
      } catch (e) {
        toast('Failed: ' + e.message, 'error');
      }
    }

    async function deleteFile(id, fileName) {
      if (!confirm('Delete file "' + fileName + '"?')) return;
      try {
        await api('/v1/files/' + id, { method: 'DELETE' });
        toast('File deleted');
        await refreshAll();
      } catch (e) {
        toast('Failed: ' + e.message, 'error');
      }
    }

    // ── Providers ───────────────────────────────

    async function loadProviders() {
      try {
        const { providers } = await api('/v1/providers');
        const grid = document.getElementById('providers-grid');

        if (!providers || providers.length === 0) {
          grid.innerHTML = '<div class="empty-msg">No providers registered.</div>';
          return;
        }

        grid.innerHTML = providers.map(p => \`
          <div class="provider-card">
            <div class="name">
              <span class="status-dot \${p.available ? 'on' : 'off'}"></span>
              \${escHtml(p.name)}
            </div>
            <div class="meta">
              <span>\${p.type.toUpperCase()}</span>
              <span>\${p.available ? 'Available' : 'Unavailable'}</span>
            </div>
          </div>
        \`).join('');

        // Populate test provider dropdown
        const sel = document.getElementById('test-provider');
        const current = sel.value;
        sel.innerHTML = '<option value="">auto</option>' +
          providers.filter(p => p.available).map(p =>
            '<option value="' + escHtml(p.id) + '">' + escHtml(p.id) + '</option>'
          ).join('');
        sel.value = current;
      } catch (e) {
        document.getElementById('providers-grid').innerHTML =
          '<div class="empty-msg" style="color:var(--red)">Failed to load providers</div>';
      }
    }

    // ── Models ──────────────────────────────────

    async function loadModels() {
      try {
        const { models } = await api('/v1/models');
        const wrap = document.getElementById('models-list');

        if (!models || models.length === 0) {
          wrap.innerHTML = '<div class="empty-msg">No models available. Add provider credentials first.</div>';
          return;
        }

        // Group by provider
        const grouped = {};
        models.forEach(m => {
          if (!grouped[m.provider]) grouped[m.provider] = [];
          grouped[m.provider].push(m);
        });

        wrap.innerHTML = Object.entries(grouped).map(([provider, items]) => \`
          <div class="models-group">
            <h3>\${escHtml(provider)}</h3>
            <div>\${items.map(m =>
              '<span class="model-chip" title="Max tokens: ' + m.maxTokens + '">' + escHtml(m.id) + '</span>'
            ).join('')}</div>
          </div>
        \`).join('');

        // Populate test model dropdown
        const sel = document.getElementById('test-model');
        const current = sel.value;
        sel.innerHTML = '<option value="">auto</option>' +
          models.map(m =>
            '<option value="' + escHtml(m.id) + '">' + escHtml(m.id) + '</option>'
          ).join('');
        sel.value = current;
      } catch (e) {
        document.getElementById('models-list').innerHTML =
          '<div class="empty-msg" style="color:var(--red)">Failed to load models</div>';
      }
    }

    // ── Test Generation ─────────────────────────

    async function runTest() {
      const prompt = document.getElementById('test-prompt').value.trim();
      if (!prompt) {
        toast('Enter a prompt first', 'error');
        return;
      }

      const provider  = document.getElementById('test-provider').value || undefined;
      const model     = document.getElementById('test-model').value || undefined;
      const project   = document.getElementById('test-project').value || undefined;
      const maxTokens = parseInt(document.getElementById('test-tokens').value, 10) || undefined;

      const btn = document.getElementById('test-btn');
      const respEl = document.getElementById('test-response');
      const metaEl = document.getElementById('test-meta');

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Generating\u2026';
      respEl.className = 'response-area visible';
      respEl.textContent = 'Waiting for response\u2026';
      metaEl.className = 'response-meta';

      try {
        const body = { prompt };
        if (provider)  body.provider  = provider;
        if (model)     body.model     = model;
        if (project)   body.project   = project;
        if (maxTokens) body.maxTokens = maxTokens;

        const result = await api('/v1/generate', {
          method: 'POST',
          body: JSON.stringify(body),
        });

        respEl.textContent = result.text;

        document.getElementById('meta-provider').textContent = '\u26A1 ' + (result.provider || '\u2014');
        document.getElementById('meta-model').textContent    = '\uD83E\uDDE0 ' + (result.model || '\u2014');
        document.getElementById('meta-tokens').textContent   = '\uD83D\uDD22 ' + (result.tokensUsed != null ? result.tokensUsed + ' tokens' : '\u2014');
        metaEl.className = 'response-meta visible';
      } catch (e) {
        respEl.textContent = 'Error: ' + e.message;
        respEl.style.color = 'var(--red)';
        setTimeout(() => respEl.style.color = '', 5000);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Generate';
      }
    }

    // ── Health ───────────────────────────────────

    async function checkHealth() {
      try {
        const data = await api('/health');
        const el = document.getElementById('health');
        el.textContent = '\u2713 Healthy';
        el.className = 'health-badge ok';
      } catch {
        const el = document.getElementById('health');
        el.textContent = '\u2717 Unreachable';
        el.className = 'health-badge err';
      }
    }

    // ── Refresh all ─────────────────────────────

    async function refreshAll() {
      await Promise.all([
        loadCredentials(),
        loadFiles(),
        loadProviders(),
        loadModels(),
      ]);
    }

    // ── Init ────────────────────────────────────

    checkHealth();
    refreshAll();
  </script>
</body>
</html>`;
}
