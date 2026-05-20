import * as path from 'node:path';
import { LayoutNode, ParsedLayout } from './ociLayout';
import { isJsonNode } from './nodePreview';

function escapeHtml(value: string | number | null | undefined): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderNodeButton(node: LayoutNode, relation: string): string {
  const subtext = getNodeSubtext(node, relation);
  return `<button class="link-button" data-action="focus" data-key="${escapeHtml(node.key)}">
    <span>${escapeHtml(node.label)}</span>
    <small>${escapeHtml(subtext)}</small>
  </button>`;
}

function getNodeSubtext(node: LayoutNode, relation: string): string {
  if (relation && relation !== getNodePrimaryName(node)) {
    return `${relation} • ${node.kind}`;
  }

  return node.kind;
}

function getNodePrimaryName(node: Pick<LayoutNode, 'displayName' | 'name'>): string {
  return node.displayName || node.name;
}

function describeNode(node: LayoutNode): string {
  const details = [node.kind];
  if (node.name && node.name !== getNodePrimaryName(node)) {
    details.push(node.name);
  }
  if (node.mediaType) {
    details.push(node.mediaType.replace(/^application\/vnd\./, ''));
  }
  if (node.digest) {
    details.push(node.digest.slice(0, 19));
  }
  return details.join(' • ');
}

function renderMetadataTable(node: LayoutNode): string {
  const rows: Array<[string, string]> = [
    ['Kind', node.kind],
    ['Media type', node.mediaType || '—'],
    ['Digest', node.digest || '—'],
    ['Size', node.size === null || node.size === undefined ? '—' : `${node.size} bytes`],
    ['Path', node.filePath || '—']
  ];

  if (node.displayName && node.displayName !== node.name) {
    rows.unshift(['Display name', node.label]);
  }

  rows.unshift(['OCI relation', node.name || '—']);

  return `<table>${rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}</table>`;
}

function renderChildren(layout: ParsedLayout, node: LayoutNode): string {
  if (!node.children || node.children.length === 0) {
    return '<p class="empty">No linked OCI descriptors.</p>';
  }

  return `<div class="link-list">${node.children.map((child) => renderNodeButton(layout.nodesByKey[child.key], child.relation)).join('')}</div>`;
}

function createNonce(): string {
  return `${Date.now()}${Math.random().toString(16).slice(2)}`;
}

function getPanelTitle(layout: ParsedLayout, focusNode: LayoutNode): string {
  return `OCI Layout: ${path.basename(layout.rootPath)} • ${focusNode.label}`;
}

export function renderLayoutErrorHtml(rootPath: string, cspSource: string): string {
  const nonce = createNonce();
  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
      <title>OCI Layout Unavailable</title>
      <style>
        body {
          font-family: var(--vscode-font-family);
          color: var(--vscode-editor-foreground);
          background: var(--vscode-editor-background);
          margin: 0;
          padding: 1rem;
        }
        .card {
          border: 1px solid var(--vscode-panel-border);
          border-radius: 8px;
          padding: 0.9rem;
        }
      </style>
    </head>
    <body>
      <section class="card">
        <h2>Unable to parse OCI layout</h2>
        <p>The folder does not currently contain a valid OCI layout.</p>
        <p><strong>Path:</strong> ${escapeHtml(rootPath)}</p>
      </section>
    </body>
  </html>`;
}

export function renderWebviewHtml(layout: ParsedLayout, focusKey: string, cspSource: string): string {
  const focusNode = layout.nodesByKey[focusKey] || layout.nodesByKey[layout.roots[1]];
  const summaryCards: Array<[string, string | number]> = [
    ['Root folder', layout.rootPath],
    ['Layout version', layout.layoutVersion || 'unknown'],
    ['Descriptors', Object.values(layout.nodesByKey).filter((node) => node.digest).length]
  ];
  const canPreview = !!focusNode.filePath;
  const previewDescription = isJsonNode(focusNode)
    ? 'Raw preview is shown in the VS Code editor for syntax highlighting and JSON folding.'
    : 'Raw preview is shown in the VS Code editor when content is text-readable.';
  const nonce = createNonce();
  const title = getPanelTitle(layout, focusNode);

  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
      <title>${escapeHtml(title)}</title>
      <style>
        :root { color-scheme: light dark; }
        body {
          font-family: var(--vscode-font-family);
          color: var(--vscode-editor-foreground);
          background: var(--vscode-editor-background);
          margin: 0;
          padding: 1rem;
        }
        h1, h2, h3 { margin: 0 0 0.75rem; }
        .grid { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
        .card {
          border: 1px solid var(--vscode-panel-border);
          border-radius: 8px;
          padding: 0.9rem;
          background: color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-textBlockQuote-background) 8%);
        }
        .layout { display: grid; gap: 1rem; grid-template-columns: 1.25fr 1fr; margin-top: 1rem; }
        @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
        table { border-collapse: collapse; width: 100%; }
        th, td {
          text-align: left;
          vertical-align: top;
          padding: 0.35rem 0;
          border-bottom: 1px solid var(--vscode-panel-border);
        }
        th { width: 8rem; font-weight: 600; }
        .link-list { display: flex; flex-wrap: wrap; gap: 0.5rem; }
        .link-button, .action-button {
          border: 1px solid var(--vscode-button-border, transparent);
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border-radius: 6px;
          cursor: pointer;
          padding: 0.5rem 0.75rem;
          text-align: left;
        }
        .link-button small { display: block; opacity: 0.75; }
        .action-button.secondary {
          background: transparent;
          color: var(--vscode-textLink-foreground);
          border-color: var(--vscode-panel-border);
        }
        .toolbar { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1rem; }
        .empty { opacity: 0.75; margin: 0; }
      </style>
    </head>
    <body>
      <h1>${escapeHtml(focusNode.label)}</h1>
      <div class="grid">
        ${summaryCards.map(([label, value]) => `<section class="card"><h3>${escapeHtml(label)}</h3><div>${escapeHtml(value)}</div></section>`).join('')}
      </div>
      <div class="layout">
        <section class="card">
          <h2>Descriptor details</h2>
          <p>${escapeHtml(describeNode(focusNode))}</p>
          <div class="toolbar">
            <button class="action-button" data-action="open" data-key="${escapeHtml(focusNode.key)}">Open raw file</button>
          </div>
          ${renderMetadataTable(focusNode)}
          <h3 style="margin-top:1rem;">Linked descriptors</h3>
          ${renderChildren(layout, focusNode)}
        </section>
        <section class="card">
          <h2>Navigation</h2>
          <div class="toolbar">
            <button class="action-button secondary" data-action="home" data-key="${escapeHtml(layout.roots[1])}">Root</button>
          </div>
          <h3>Raw preview</h3>
          ${canPreview
    ? `<p class="empty">${escapeHtml(previewDescription)}</p>
             <div class="toolbar">
               <button class="action-button secondary" data-action="preview" data-key="${escapeHtml(focusNode.key)}">Reveal raw preview</button>
             </div>`
    : '<p class="empty">No associated file for this node.</p>'}
        </section>
      </div>
      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        document.addEventListener('click', (event) => {
          const target = event.target.closest('[data-action]');
          if (!target) {
            return;
          }

          const command = target.dataset.action === 'focus'
            ? 'focusNode'
            : target.dataset.action === 'home'
              ? 'goHome'
              : target.dataset.action === 'preview'
                ? 'openPreview'
              : 'openFile';
          vscode.postMessage({ command, key: target.dataset.key });
        });
      </script>
    </body>
  </html>`;
}
