const path = require('node:path');
const vscode = require('vscode');
const { parseLayout } = require('./ociLayout');

const CONTEXT_UPDATE_DEBOUNCE_MS = 50;

class LayoutTreeItem extends vscode.TreeItem {
  constructor(node) {
    super(
      node.label,
      node.children && node.children.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );

    this.node = node;
    this.contextValue = node.filePath ? 'ociNode' : 'ociInfo';
    this.description = describeNode(node);
    this.tooltip = new vscode.MarkdownString(getTooltip(node));
    this.iconPath = getIcon(node.kind);

    if (node.filePath) {
      this.command = {
        command: 'ociExplorer.focusNode',
        title: 'Focus OCI Node',
        arguments: [node.key]
      };
    }
  }
}

class OciTreeProvider {
  constructor(onNodeFocused) {
    this.onNodeFocused = onNodeFocused;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    this.layout = null;
  }

  setLayout(layout) {
    this.layout = layout;
    this.refresh();
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return new LayoutTreeItem(element);
  }

  getChildren(element) {
    if (!this.layout) {
      return [
        {
          key: 'empty',
          label: 'Open an OCI layout folder',
          kind: 'info',
          children: [],
          filePath: null
        }
      ];
    }

    if (!element) {
      return this.layout.roots.map((key) => this.layout.nodesByKey[key]);
    }

    return (element.children || []).map((child) => this.layout.nodesByKey[child.key]);
  }
}

class OciPanelController {
  constructor(context) {
    this.context = context;
    this.panel = null;
    this.currentLayout = null;
    this.focusKey = null;
    this.history = [];
  }

  show(layout, focusKey, options = {}) {
    const { addToHistory = false, resetHistory = false, reveal = true } = options;

    this.currentLayout = layout;
    const nextFocusKey = focusKey || layout.roots[1];

    if (resetHistory) {
      this.history = [];
    } else if (addToHistory && this.focusKey && this.focusKey !== nextFocusKey) {
      this.history.push(this.focusKey);
    }

    this.focusKey = nextFocusKey;
    const focusNode = layout.nodesByKey[this.focusKey] || layout.nodesByKey[layout.roots[1]];
    this.focusKey = focusNode.key;

    if (!this.panel) {
      const viewColumn = vscode.window.activeTextEditor && vscode.window.activeTextEditor.viewColumn
        ? vscode.window.activeTextEditor.viewColumn
        : vscode.ViewColumn.One;
      this.panel = vscode.window.createWebviewPanel(
        'ociExplorer.details',
        'OCI Layout Details',
        viewColumn,
        { enableScripts: true }
      );

      this.panel.webview.onDidReceiveMessage((message) => {
        if (!this.currentLayout) {
          return;
        }

        if (message.command === 'focusNode' && message.key && this.currentLayout.nodesByKey[message.key]) {
          this.show(this.currentLayout, message.key, { addToHistory: true, reveal: false });
          return;
        }

        if (message.command === 'goBack') {
          this.goBack();
          return;
        }

        if (message.command === 'goHome') {
          this.show(this.currentLayout, this.currentLayout.roots[1], { addToHistory: true, reveal: false });
          return;
        }

        if (message.command === 'openFile' && message.key && this.currentLayout.nodesByKey[message.key]) {
          openNodeFile(this.currentLayout.nodesByKey[message.key]);
        }
      });

      this.panel.onDidDispose(() => {
        this.panel = null;
      });
    }

    this.panel.title = getPanelTitle(layout, focusNode);
    this.panel.webview.html = renderWebviewHtml(layout, this.focusKey, this.panel.webview.cspSource, {
      canGoBack: this.history.length > 0
    });

    if (reveal) {
      this.panel.reveal(this.panel.viewColumn, true);
    }
  }

  goBack() {
    if (!this.currentLayout || this.history.length === 0) {
      return;
    }

    const previousKey = this.history.pop();
    this.show(this.currentLayout, previousKey, { reveal: false });
  }
}

function describeNode(node) {
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

function getTooltip(node) {
  const lines = [`**${node.label}**`, '', `Kind: \`${node.kind}\``];
  if (node.mediaType) {
    lines.push(`Media type: \`${node.mediaType}\``);
  }
  if (node.digest) {
    lines.push(`Digest: \`${node.digest}\``);
  }
  if (node.filePath) {
    lines.push(`File: \`${node.filePath}\``);
  }
  return lines.join('\n\n');
}

function getIcon(kind) {
  if (kind === 'image-index') {
    return new vscode.ThemeIcon('references');
  }

  if (kind === 'image-manifest') {
    return new vscode.ThemeIcon('package');
  }

  if (kind === 'config') {
    return new vscode.ThemeIcon('settings-gear');
  }

  if (kind === 'layer') {
    return new vscode.ThemeIcon('archive');
  }

  if (kind === 'layout') {
    return new vscode.ThemeIcon('folder-library');
  }

  return new vscode.ThemeIcon('file');
}

async function openNodeFile(node) {
  if (!node || !node.filePath) {
    return;
  }

  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(node.filePath));
  await vscode.window.showTextDocument(document, { preview: false });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderNodeButton(node, relation) {
  const subtext = getNodeSubtext(node, relation);
  return `<button class="link-button" data-action="focus" data-key="${escapeHtml(node.key)}">
    <span>${escapeHtml(node.label)}</span>
    <small>${escapeHtml(subtext)}</small>
  </button>`;
}

function getNodeSubtext(node, relation) {
  if (relation && relation !== getNodePrimaryName(node)) {
    return `${relation} • ${node.kind}`;
  }

  return node.kind;
}

function getNodePrimaryName(node) {
  return node.displayName || node.name;
}

function renderMetadataTable(node) {
  const rows = [
    ['Kind', node.kind],
    ['Media type', node.mediaType || '—'],
    ['Digest', node.digest || '—'],
    ['Size', node.size == null ? '—' : `${node.size} bytes`],
    ['Path', node.filePath || '—']
  ];

  if (node.displayName && node.displayName !== node.name) {
    rows.unshift(['Display name', node.label]);
  }

  rows.unshift(['OCI relation', node.name || '—']);

  return `<table>${rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}</table>`;
}

function renderChildren(layout, node) {
  if (!node.children || node.children.length === 0) {
    return '<p class="empty">No linked OCI descriptors.</p>';
  }

  return `<div class="link-list">${node.children.map((child) => renderNodeButton(layout.nodesByKey[child.key], child.relation)).join('')}</div>`;
}

function createNonce() {
  return `${Date.now()}${Math.random().toString(16).slice(2)}`;
}

function getPanelTitle(layout, focusNode) {
  return `OCI Layout: ${path.basename(layout.rootPath)} • ${focusNode.label}`;
}

function renderWebviewHtml(layout, focusKey, cspSource, options = {}) {
  const focusNode = layout.nodesByKey[focusKey] || layout.nodesByKey[layout.roots[1]];
  const { canGoBack = false } = options;
  const summaryCards = [
    ['Root folder', layout.rootPath],
    ['Layout version', layout.layoutVersion || 'unknown'],
    ['Descriptors', Object.values(layout.nodesByKey).filter((node) => node.digest).length]
  ];
  const rawJson = focusNode.json ? JSON.stringify(focusNode.json, null, 2) : null;
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
        :root {
          color-scheme: light dark;
        }
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
        .layout {
          display: grid;
          gap: 1rem;
          grid-template-columns: 1.25fr 1fr;
          margin-top: 1rem;
        }
        @media (max-width: 900px) {
          .layout { grid-template-columns: 1fr; }
        }
        table {
          border-collapse: collapse;
          width: 100%;
        }
        th, td {
          text-align: left;
          vertical-align: top;
          padding: 0.35rem 0;
          border-bottom: 1px solid var(--vscode-panel-border);
        }
        th { width: 8rem; font-weight: 600; }
        .link-list {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }
        .link-button, .action-button {
          border: 1px solid var(--vscode-button-border, transparent);
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border-radius: 6px;
          cursor: pointer;
          padding: 0.5rem 0.75rem;
          text-align: left;
        }
        .link-button small {
          display: block;
          opacity: 0.75;
        }
        .action-button.secondary {
          background: transparent;
          color: var(--vscode-textLink-foreground);
          border-color: var(--vscode-panel-border);
        }
        .action-button:disabled {
          cursor: default;
          opacity: 0.55;
        }
        .toolbar {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
          margin-bottom: 1rem;
        }
        pre {
          white-space: pre-wrap;
          overflow-wrap: anywhere;
          padding: 0.8rem;
          border-radius: 8px;
          background: var(--vscode-textCodeBlock-background);
          border: 1px solid var(--vscode-panel-border);
        }
        .empty {
          opacity: 0.75;
          margin: 0;
        }
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
            <button class="action-button secondary" data-action="back" ${canGoBack ? '' : 'disabled'}>Back</button>
            <button class="action-button secondary" data-action="home" data-key="${escapeHtml(layout.roots[1])}">Home/Root/Index</button>
          </div>
          <h3>Raw preview</h3>
          ${rawJson ? `<pre>${escapeHtml(rawJson)}</pre>` : '<p class="empty">Binary or non-JSON content; use "Open raw file" to inspect it directly.</p>'}
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
            : target.dataset.action === 'back'
              ? 'goBack'
              : target.dataset.action === 'home'
                ? 'goHome'
                : 'openFile';
          vscode.postMessage({ command, key: target.dataset.key });
        });
      </script>
    </body>
  </html>`;
}

async function promptForLayoutFolder() {
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Open OCI Layout Folder'
  });

  return selected && selected[0] ? selected[0].fsPath : null;
}

function activate(context) {
  const panelController = new OciPanelController(context);
  const treeProvider = new OciTreeProvider((nodeKey) => panelController.show(treeProvider.layout, nodeKey));
  let contextUpdateTimer = null;

  const uriHasType = async (uri, type) => {
    try {
      return (await vscode.workspace.fs.stat(uri)).type === type;
    } catch (error) {
      return false;
    }
  };

  const isOciLayoutFolderUri = async (rootUri) => {
    const [hasLayout, hasIndex, hasBlobs] = await Promise.all([
      uriHasType(vscode.Uri.joinPath(rootUri, 'oci-layout'), vscode.FileType.File),
      uriHasType(vscode.Uri.joinPath(rootUri, 'index.json'), vscode.FileType.File),
      uriHasType(vscode.Uri.joinPath(rootUri, 'blobs'), vscode.FileType.Directory)
    ]);

    return hasLayout && hasIndex && hasBlobs;
  };

  const updateLayoutFolderContext = async () => {
    const layoutFiles = await vscode.workspace.findFiles('**/oci-layout', '**/node_modules/**');
    const layoutFolders = [];

    const folderChecks = layoutFiles.map(async (layoutFile) => {
      const rootPath = path.dirname(layoutFile.fsPath);
      if (await isOciLayoutFolderUri(vscode.Uri.file(rootPath))) {
        layoutFolders.push(rootPath);
      }
    });

    await Promise.all(folderChecks);
    await vscode.commands.executeCommand('setContext', 'ociExplorer.layoutFolders', layoutFolders);
  };

  const scheduleLayoutFolderContextUpdate = () => {
    clearTimeout(contextUpdateTimer);
    contextUpdateTimer = setTimeout(() => {
      updateLayoutFolderContext().catch((error) => {
        console.error('Failed to refresh OCI layout folder context.', error);
      });
    }, CONTEXT_UPDATE_DEBOUNCE_MS);
  };

  const refreshFromPath = async (rootPath, preferredKey) => {
    if (!rootPath) {
      treeProvider.setLayout(null);
      return;
    }

    try {
      const layout = parseLayout(rootPath);
      treeProvider.setLayout(layout);
      await context.workspaceState.update('ociExplorer.rootPath', rootPath);
      panelController.show(layout, preferredKey || layout.roots[1], { resetHistory: true });
    } catch (error) {
      vscode.window.showErrorMessage(error.message);
    }
  };

  const initialPath = context.workspaceState.get('ociExplorer.rootPath');
  if (initialPath) {
    refreshFromPath(initialPath);
  }

  scheduleLayoutFolderContextUpdate();

  const treeView = vscode.window.createTreeView('ociExplorer.layout', {
    treeDataProvider: treeProvider,
    showCollapseAll: true
  });

  const contextWatchers = [
    vscode.workspace.createFileSystemWatcher('**/oci-layout'),
    vscode.workspace.createFileSystemWatcher('**/index.json'),
    vscode.workspace.createFileSystemWatcher('**/blobs')
  ];

  contextWatchers.forEach((watcher) => {
    watcher.onDidCreate(scheduleLayoutFolderContextUpdate);
    watcher.onDidDelete(scheduleLayoutFolderContextUpdate);
  });

  context.subscriptions.push(
    treeView,
    ...contextWatchers,
    { dispose: () => clearTimeout(contextUpdateTimer) },
    vscode.workspace.onDidChangeWorkspaceFolders(scheduleLayoutFolderContextUpdate),
    vscode.commands.registerCommand('ociExplorer.openLayout', async (resource) => {
      const rootPath = resource && typeof resource.fsPath === 'string'
        ? resource.fsPath
        : await promptForLayoutFolder();
      if (rootPath) {
        await refreshFromPath(rootPath);
      }
    }),
    vscode.commands.registerCommand('ociExplorer.openLayoutFromExplorer', async (resource) => {
      await vscode.commands.executeCommand('ociExplorer.openLayout', resource);
    }),
    vscode.commands.registerCommand('ociExplorer.refresh', async () => {
      const rootPath = context.workspaceState.get('ociExplorer.rootPath');
      if (rootPath) {
        await refreshFromPath(rootPath, panelController.focusKey);
      }
    }),
    vscode.commands.registerCommand('ociExplorer.focusNode', async (nodeKey) => {
      if (!treeProvider.layout || !treeProvider.layout.nodesByKey[nodeKey]) {
        return;
      }
      panelController.show(treeProvider.layout, nodeKey, { addToHistory: true });
    }),
    vscode.commands.registerCommand('ociExplorer.openRawFile', async (node) => {
      if (node && node.filePath) {
        await openNodeFile(node);
        return;
      }

      const current = treeProvider.layout && panelController.focusKey
        ? treeProvider.layout.nodesByKey[panelController.focusKey]
        : null;
      await openNodeFile(current);
    }),
    treeView.onDidChangeSelection(async (event) => {
      const [node] = event.selection;
      if (node && treeProvider.layout && treeProvider.layout.nodesByKey[node.key]) {
        panelController.show(treeProvider.layout, node.key, { addToHistory: true });
      }
    })
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
