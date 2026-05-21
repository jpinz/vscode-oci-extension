import { LayoutNode, ParsedLayout } from './ociLayout';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function kindIcon(kind: string): string {
  const icons: Record<string, string> = {
    'image-index': '📑',
    'image-manifest': '📦',
    'config': '⚙️',
    'layer': '🗄️',
    'layout': '📂',
    'blob': '📄'
  };
  return icons[kind] || '📄';
}

function renderMetadataTable(node: LayoutNode): string {
  const rows: Array<[string, string]> = [];

  rows.push(['Kind', `${kindIcon(node.kind)} ${escapeHtml(node.kind)}`]);

  if (node.mediaType) {
    rows.push(['Media Type', `<code>${escapeHtml(node.mediaType)}</code>`]);
  }
  if (node.digest) {
    rows.push(['Digest', `<code>${escapeHtml(node.digest)}</code>`]);
  }
  if (node.size !== null && node.size !== undefined) {
    rows.push(['Size', formatBytes(node.size)]);
  }
  if (node.artifactType) {
    rows.push(['Artifact Type', `<code>${escapeHtml(node.artifactType)}</code>`]);
  }
  if (node.platform) {
    const parts = [node.platform.os, node.platform.architecture, node.platform.variant].filter(Boolean);
    if (parts.length) {
      rows.push(['Platform', escapeHtml(parts.join('/'))]);
    }
  }

  return `<table class="metadata">${rows.map(([label, value]) =>
    `<tr><th>${escapeHtml(label)}</th><td>${value}</td></tr>`
  ).join('')}</table>`;
}

function renderAnnotations(annotations: Record<string, string> | null | undefined): string {
  if (!annotations || Object.keys(annotations).length === 0) {
    return '';
  }

  const rows = Object.entries(annotations).map(([key, value]) =>
    `<tr><td><code>${escapeHtml(key)}</code></td><td>${escapeHtml(String(value))}</td></tr>`
  ).join('');

  return `
    <details open>
      <summary>Annotations (${Object.keys(annotations).length})</summary>
      <table class="annotations">${rows}</table>
    </details>`;
}

function findParent(node: LayoutNode, layout: ParsedLayout): LayoutNode | null {
  for (const candidate of layout.nodes) {
    if (candidate.children.some((child) => child.key === node.key)) {
      return candidate;
    }
  }
  return null;
}

function renderParent(node: LayoutNode, layout: ParsedLayout): string {
  const parent = findParent(node, layout);
  if (!parent) {
    return '';
  }

  const label = parent.label || parent.name;
  return `<div class="parent-link">
    ↑ <a href="#" class="child-link" data-key="${escapeHtml(parent.key)}">${kindIcon(parent.kind)} ${escapeHtml(label)}</a>
  </div>`;
}

function renderChildItem(child: { relation: string; key: string }, layout: ParsedLayout): string {
  const childNode = layout.nodesByKey[child.key];
  if (!childNode) {
    return `<li class="child-item">${escapeHtml(child.relation)} — <em>missing</em></li>`;
  }

  const label = childNode.label || childNode.name || child.relation;
  const desc = childNode.mediaType
    ? ` <span class="child-meta">${escapeHtml(childNode.mediaType.replace(/^application\/vnd\./, ''))}</span>`
    : '';
  const digestSnippet = childNode.digest
    ? ` <span class="child-digest">${escapeHtml(childNode.digest.slice(0, 19))}…</span>`
    : '';

  return `<li class="child-item">
    <span class="child-relation">${escapeHtml(child.relation)}</span>
    <a href="#" class="child-link" data-key="${escapeHtml(child.key)}">${kindIcon(childNode.kind)} ${escapeHtml(label)}</a>
    ${desc}${digestSnippet}
  </li>`;
}

function isTarLayer(child: { key: string }, layout: ParsedLayout): boolean {
  const childNode = layout.nodesByKey[child.key];
  if (!childNode || childNode.kind !== 'layer') {
    return false;
  }
  const mt = childNode.mediaType || '';
  return mt.includes('tar') || (!mt.includes('json') && !mt.includes('xml') && !mt.includes('text'));
}

function renderChildren(node: LayoutNode, layout: ParsedLayout): string {
  if (!node.children || node.children.length === 0) {
    return '';
  }

  const mainChildren = node.children.filter((child) => !isTarLayer(child, layout));
  const tarLayers = node.children.filter((child) => isTarLayer(child, layout));

  let html = '';

  if (mainChildren.length > 0) {
    const items = mainChildren.map((child) => renderChildItem(child, layout)).join('');
    html += `
    <details open>
      <summary>Children (${mainChildren.length})</summary>
      <ul class="children">${items}</ul>
    </details>`;
  }

  if (tarLayers.length > 0) {
    const items = tarLayers.map((child) => renderChildItem(child, layout)).join('');
    html += `
    <details>
      <summary>Binary Layers (${tarLayers.length})</summary>
      <ul class="children">${items}</ul>
    </details>`;
  }

  return html;
}

function renderJsonContent(node: LayoutNode): string {
  if (node.parseError) {
    return `<details><summary>Raw Content</summary><pre class="json-error">Parse error: ${escapeHtml(node.parseError)}</pre></details>`;
  }
  if (!node.json) {
    return '';
  }

  return `
    <details id="jsonDetails">
      <summary>JSON Content</summary>
      <pre class="json-content"><code id="jsonContent">Loading…</code></pre>
    </details>`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) { return '0 B'; }
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function renderNodeHtml(node: LayoutNode, layout: ParsedLayout): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${CSS}</style>
</head>
<body>
  <div class="container">
    <header>
      <h1>${kindIcon(node.kind)} ${escapeHtml(node.label)}</h1>
      ${node.displayName && node.displayName !== node.label
        ? `<p class="display-name">${escapeHtml(node.displayName)}</p>` : ''}
      <button class="open-raw" id="openRawBtn">Open Raw File</button>
    </header>

    ${renderParent(node, layout)}
    ${renderMetadataTable(node)}
    ${renderAnnotations(node.annotations)}
    ${renderChildren(node, layout)}
    ${renderJsonContent(node)}
  </div>

  <script>${SCRIPT}</script>
</body>
</html>`;
}

export function renderErrorHtml(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>${CSS}</style>
</head>
<body>
  <div class="container">
    <div class="error-box">
      <h2>Error</h2>
      <p>${escapeHtml(message)}</p>
    </div>
  </div>
</body>
</html>`;
}

const SCRIPT = `
  const vscode = acquireVsCodeApi();

  document.getElementById('openRawBtn')?.addEventListener('click', () => {
    vscode.postMessage({ command: 'openRawFile' });
  });

  document.querySelectorAll('.child-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const key = e.currentTarget.getAttribute('data-key');
      if (key) {
        vscode.postMessage({ command: 'focusNode', key });
      }
    });
  });

  const jsonDetails = document.getElementById('jsonDetails');
  let jsonLoaded = false;
  if (jsonDetails) {
    jsonDetails.addEventListener('toggle', () => {
      if (jsonDetails.open && !jsonLoaded) {
        jsonLoaded = true;
        vscode.postMessage({ command: 'loadJson' });
      }
    });
  }

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.command === 'jsonContent') {
      const el = document.getElementById('jsonContent');
      if (el) {
        el.textContent = msg.content;
      }
    }
  });
`;

const CSS = `
  :root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border, var(--vscode-widget-border, #444));
    --link: var(--vscode-textLink-foreground, #3794ff);
    --header-bg: var(--vscode-sideBarSectionHeader-background, transparent);
    --badge-bg: var(--vscode-badge-background, #4d4d4d);
    --badge-fg: var(--vscode-badge-foreground, #fff);
    --code-bg: var(--vscode-textCodeBlock-background, #1e1e1e);
    --button-bg: var(--vscode-button-background, #0e639c);
    --button-fg: var(--vscode-button-foreground, #fff);
    --button-hover: var(--vscode-button-hoverBackground, #1177bb);
    --error-bg: var(--vscode-inputValidation-errorBackground, #5a1d1d);
    --error-border: var(--vscode-inputValidation-errorBorder, #be1100);
  }

  body {
    background: var(--bg);
    color: var(--fg);
    font-family: var(--vscode-font-family, system-ui, sans-serif);
    font-size: var(--vscode-font-size, 13px);
    line-height: 1.5;
    margin: 0;
    padding: 0;
  }

  .container {
    max-width: 800px;
    margin: 0 auto;
    padding: 20px;
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 20px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }

  h1 {
    margin: 0;
    font-size: 1.4em;
    font-weight: 600;
  }

  .display-name {
    margin: 0;
    opacity: 0.7;
    font-size: 0.9em;
  }

  .open-raw {
    margin-left: auto;
    background: var(--button-bg);
    color: var(--button-fg);
    border: none;
    padding: 4px 12px;
    border-radius: 2px;
    cursor: pointer;
    font-size: 0.85em;
  }
  .open-raw:hover { background: var(--button-hover); }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0;
  }

  .metadata th {
    text-align: left;
    width: 120px;
    padding: 4px 12px 4px 0;
    opacity: 0.7;
    font-weight: normal;
    vertical-align: top;
    white-space: nowrap;
  }
  .metadata td {
    padding: 4px 0;
    word-break: break-all;
  }

  .annotations td {
    padding: 4px 8px;
    border-bottom: 1px solid var(--border);
    word-break: break-all;
  }
  .annotations td:first-child {
    white-space: nowrap;
    width: 1%;
  }

  details {
    margin: 16px 0;
  }
  summary {
    cursor: pointer;
    font-weight: 600;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
    user-select: none;
  }

  .children {
    list-style: none;
    padding: 0;
    margin: 8px 0;
  }
  .child-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border);
  }
  .child-relation {
    background: var(--badge-bg);
    color: var(--badge-fg);
    padding: 1px 6px;
    border-radius: 2px;
    font-size: 0.8em;
    white-space: nowrap;
  }
  .child-link {
    color: var(--link);
    text-decoration: none;
    cursor: pointer;
  }
  .child-link:hover { text-decoration: underline; }
  .parent-link {
    margin-bottom: 16px;
    font-size: 0.95em;
  }
  .child-meta {
    opacity: 0.6;
    font-size: 0.85em;
  }
  .child-digest {
    opacity: 0.45;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.8em;
  }

  code {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.9em;
  }

  .json-content, .json-error {
    background: var(--code-bg);
    padding: 12px;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.85em;
    max-height: 500px;
    overflow-y: auto;
  }

  .error-box {
    background: var(--error-bg);
    border: 1px solid var(--error-border);
    padding: 16px;
    border-radius: 4px;
  }
  .error-box h2 { margin-top: 0; }
`;
