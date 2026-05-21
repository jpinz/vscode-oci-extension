import * as path from 'node:path';
import * as vscode from 'vscode';
import { LayoutNode, ParsedLayout, parseLayout, isOciLayoutFolder } from './ociLayout';
import { renderNodeHtml, renderErrorHtml } from './webview';

class OciDocument implements vscode.CustomDocument {
  readonly uri: vscode.Uri;
  layout: ParsedLayout;
  focusKey: string;

  constructor(uri: vscode.Uri, layout: ParsedLayout, focusKey: string) {
    this.uri = uri;
    this.layout = layout;
    this.focusKey = focusKey;
  }

  dispose(): void {}
}

export class OciBlobEditorProvider implements vscode.CustomReadonlyEditorProvider<OciDocument> {
  static readonly viewType = 'ociExplorer.blobViewer';

  private readonly panels = new Map<vscode.WebviewPanel, OciDocument>();
  private onFocusNodeCallback: ((nodeKey: string) => void) | null = null;

  onFocusNode(callback: (nodeKey: string) => void): void {
    this.onFocusNodeCallback = callback;
  }

  openCustomDocument(uri: vscode.Uri): OciDocument {
    const layoutRoot = findLayoutRoot(uri.fsPath);
    if (!layoutRoot) {
      throw new Error(`Could not find an OCI layout containing '${uri.fsPath}'.`);
    }

    const layout = parseLayout(layoutRoot);
    const focusKey = findNodeKeyForFile(layout, uri.fsPath) || layout.roots[0];
    return new OciDocument(uri, layout, focusKey);
  }

  resolveCustomEditor(
    document: OciDocument,
    webviewPanel: vscode.WebviewPanel
  ): void {
    this.panels.set(webviewPanel, document);
    webviewPanel.webview.options = { enableScripts: true };

    this.updateWebview(webviewPanel, document);

    webviewPanel.webview.onDidReceiveMessage((message: { command: string; key?: string }) => {
      if (message.command === 'focusNode' && message.key) {
        const node = document.layout.nodesByKey[message.key];
        if (node && node.filePath) {
          void vscode.commands.executeCommand(
            'vscode.openWith',
            vscode.Uri.file(node.filePath),
            OciBlobEditorProvider.viewType
          );
        }
        if (this.onFocusNodeCallback && message.key) {
          this.onFocusNodeCallback(message.key);
        }
      } else if (message.command === 'openRawFile') {
        const node = document.layout.nodesByKey[document.focusKey];
        if (node && node.filePath) {
          void vscode.workspace.openTextDocument(vscode.Uri.file(node.filePath)).then((doc) =>
            vscode.window.showTextDocument(doc, { preview: false, viewColumn: vscode.ViewColumn.Beside })
          );
        }
      } else if (message.command === 'loadJson') {
        const node = document.layout.nodesByKey[document.focusKey];
        const content = node && node.json ? JSON.stringify(node.json, null, 2) : '';
        void webviewPanel.webview.postMessage({ command: 'jsonContent', content });
      }
    });

    webviewPanel.onDidDispose(() => {
      this.panels.delete(webviewPanel);
    });
  }

  refreshAll(layout: ParsedLayout): void {
    for (const [panel, document] of this.panels) {
      document.layout = layout;
      const newKey = findNodeKeyForFile(layout, document.uri.fsPath);
      if (newKey) {
        document.focusKey = newKey;
      }
      this.updateWebview(panel, document);
    }
  }

  private updateWebview(panel: vscode.WebviewPanel, document: OciDocument): void {
    const node = document.layout.nodesByKey[document.focusKey];
    if (!node) {
      panel.webview.html = renderErrorHtml('Node not found in layout.');
      return;
    }

    panel.title = node.label;
    panel.webview.html = renderNodeHtml(node, document.layout);
  }
}

function findLayoutRoot(filePath: string): string | null {
  let dir = path.dirname(filePath);
  for (let i = 0; i < 10; i++) {
    if (isOciLayoutFolder(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

function findNodeKeyForFile(layout: ParsedLayout, filePath: string): string | null {
  const resolved = path.resolve(filePath);
  for (const node of layout.nodes) {
    if (node.filePath && path.resolve(node.filePath) === resolved) {
      return node.key;
    }
  }
  return null;
}
