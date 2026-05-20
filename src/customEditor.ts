import * as path from 'node:path';
import * as vscode from 'vscode';
import { LayoutNode, ParsedLayout, parseLayout } from './ociLayout';
import { openNodeFile, openNodePreview } from './nodePreview';
import { renderLayoutErrorHtml, renderWebviewHtml } from './webview';

interface EditorSession {
  rootPath: string;
  webviewPanel: vscode.WebviewPanel;
}

export class OciPanelController implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'ociExplorer.layoutEditor';

  private readonly sessionsByRootPath = new Map<string, Set<EditorSession>>();
  private readonly pendingFocusByRootPath = new Map<string, string>();
  currentLayout: ParsedLayout | null = null;
  focusKey: string | null = null;

  setFocus(layout: ParsedLayout | null, focusKey?: string): LayoutNode | undefined {
    if (!layout || !layout.nodesByKey) {
      return undefined;
    }

    const defaultKey = Array.isArray(layout.roots)
      ? (layout.roots[1] ?? layout.roots[0])
      : undefined;
    const resolvedKey = focusKey || defaultKey;
    const focusNode = resolvedKey ? layout.nodesByKey[resolvedKey] : undefined;
    if (!focusNode) {
      return undefined;
    }

    this.currentLayout = layout;
    this.focusKey = focusNode.key;
    if (layout.rootPath) {
      this.pendingFocusByRootPath.set(layout.rootPath, focusNode.key);
    }

    return focusNode;
  }

  hide(): void {
    // Custom editors are part of VS Code's editor area and user-managed.
  }

  show(layout: ParsedLayout, focusKey?: string, options: { reveal?: boolean } = {}): void {
    const { reveal = true } = options;
    const focusNode = this.setFocus(layout, focusKey);
    if (!focusNode) {
      return;
    }

    const openPromise = vscode.commands.executeCommand(
      'vscode.openWith',
      vscode.Uri.file(path.join(layout.rootPath, 'oci-layout')),
      OciPanelController.viewType,
      {
        preserveFocus: !reveal,
        preview: !reveal
      }
    );

    void Promise.resolve(openPromise).then(() => {
      this.updateSessions(layout.rootPath, layout);
    }).catch((error: unknown) => {
      console.error('Failed to open OCI custom editor.', error);
    });
  }

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(
      OciPanelController.viewType,
      this,
      {
        webviewOptions: {
          retainContextWhenHidden: true
        },
        supportsMultipleEditorsPerDocument: true
      }
    ));
  }

  resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): void {
    const rootPath = path.dirname(document.uri.fsPath);
    webviewPanel.webview.options = { enableScripts: true };

    const session: EditorSession = { rootPath, webviewPanel };
    if (!this.sessionsByRootPath.has(rootPath)) {
      this.sessionsByRootPath.set(rootPath, new Set());
    }
    this.sessionsByRootPath.get(rootPath)?.add(session);

    webviewPanel.webview.onDidReceiveMessage((message: { command?: string; key?: string }) => {
      const layout = this.readLayout(rootPath);
      if (!layout) {
        return;
      }

      if (message.command === 'focusNode' && message.key && layout.nodesByKey[message.key]) {
        this.setFocus(layout, message.key);
        this.updateSessions(rootPath, layout);
        return;
      }

      if (message.command === 'goHome') {
        const homeKey = layout.roots[1] || layout.roots[0];
        this.setFocus(layout, homeKey);
        this.updateSessions(rootPath, layout);
        return;
      }

      if (message.command === 'openFile' && message.key && layout.nodesByKey[message.key]) {
        void openNodeFile(layout.nodesByKey[message.key]);
        return;
      }

      if (message.command === 'openPreview' && message.key && layout.nodesByKey[message.key]) {
        void openNodePreview(layout.nodesByKey[message.key]).catch((error: unknown) => {
          console.error('Failed to open OCI raw preview.', error);
        });
      }
    });

    webviewPanel.onDidDispose(() => {
      const sessions = this.sessionsByRootPath.get(rootPath);
      if (!sessions) {
        return;
      }

      sessions.delete(session);
      if (sessions.size === 0) {
        this.sessionsByRootPath.delete(rootPath);
      }
    });

    this.updateSessions(rootPath);
  }

  private readLayout(rootPath: string): ParsedLayout | null {
    try {
      return parseLayout(rootPath);
    } catch {
      return null;
    }
  }

  private updateSessions(rootPath: string, knownLayout?: ParsedLayout): void {
    const sessions = this.sessionsByRootPath.get(rootPath);
    if (!sessions || sessions.size === 0) {
      return;
    }

    const layout = knownLayout || this.readLayout(rootPath);
    if (!layout) {
      for (const session of sessions) {
        session.webviewPanel.webview.html = renderLayoutErrorHtml(rootPath, session.webviewPanel.webview.cspSource);
      }
      return;
    }

    const preferredKey = this.pendingFocusByRootPath.get(rootPath) || this.focusKey || undefined;
    const focusNode = layout.nodesByKey[preferredKey || ''] || layout.nodesByKey[layout.roots[1]] || layout.nodesByKey[layout.roots[0]];
    if (!focusNode) {
      return;
    }

    this.currentLayout = layout;
    this.focusKey = focusNode.key;
    this.pendingFocusByRootPath.set(rootPath, focusNode.key);

    for (const session of sessions) {
      session.webviewPanel.webview.html = renderWebviewHtml(layout, focusNode.key, session.webviewPanel.webview.cspSource);
    }

    void openNodePreview(focusNode).catch((error: unknown) => {
      console.error('Failed to open OCI raw preview.', error);
    });
  }
}
