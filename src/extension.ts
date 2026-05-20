import * as path from 'node:path';
import * as vscode from 'vscode';
import { CONTEXT_UPDATE_DEBOUNCE_MS, NAVIGATION_MODE_SETTING } from './constants';
import { OciPanelController } from './customEditor';
import { getNavigationPreferences } from './navigation';
import { LayoutNode, parseLayout } from './ociLayout';
import { openNodeFile } from './nodePreview';
import { OciTreeProvider } from './tree';

async function promptForLayoutFolder(): Promise<string | null> {
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Open OCI Layout Folder'
  });

  return selected && selected[0] ? selected[0].fsPath : null;
}

export function activate(context: vscode.ExtensionContext): void {
  const panelController = new OciPanelController();
  panelController.register(context);

  const treeProvider = new OciTreeProvider();
  let contextUpdateTimer: ReturnType<typeof setTimeout> | null = null;

  const applyNavigationPreferences = (): void => {
    const { showWebview } = getNavigationPreferences();
    if (!showWebview) {
      panelController.hide();
    }
  };

  const uriHasType = async (uri: vscode.Uri, type: vscode.FileType): Promise<boolean> => {
    try {
      return (await vscode.workspace.fs.stat(uri)).type === type;
    } catch {
      return false;
    }
  };

  const isOciLayoutFolderUri = async (rootUri: vscode.Uri): Promise<boolean> => {
    const [hasLayout, hasIndex, hasBlobs] = await Promise.all([
      uriHasType(vscode.Uri.joinPath(rootUri, 'oci-layout'), vscode.FileType.File),
      uriHasType(vscode.Uri.joinPath(rootUri, 'index.json'), vscode.FileType.File),
      uriHasType(vscode.Uri.joinPath(rootUri, 'blobs'), vscode.FileType.Directory)
    ]);

    return hasLayout && hasIndex && hasBlobs;
  };

  const updateLayoutFolderContext = async (): Promise<void> => {
    const layoutFiles = await vscode.workspace.findFiles('**/oci-layout', '**/node_modules/**');
    const layoutFolders: string[] = [];

    const folderChecks = layoutFiles.map(async (layoutFile) => {
      const rootPath = path.dirname(layoutFile.fsPath);
      if (await isOciLayoutFolderUri(vscode.Uri.file(rootPath))) {
        layoutFolders.push(rootPath);
      }
    });

    await Promise.all(folderChecks);
    await vscode.commands.executeCommand('setContext', 'ociExplorer.layoutFolders', layoutFolders);
  };

  const scheduleLayoutFolderContextUpdate = (): void => {
    if (contextUpdateTimer) {
      clearTimeout(contextUpdateTimer);
    }

    contextUpdateTimer = setTimeout(() => {
      void updateLayoutFolderContext().catch((error: unknown) => {
        console.error('Failed to refresh OCI layout folder context.', error);
      });
    }, CONTEXT_UPDATE_DEBOUNCE_MS);
  };

  const refreshFromPath = async (rootPath: string | undefined, preferredKey?: string | null): Promise<void> => {
    if (!rootPath) {
      treeProvider.setLayout(null);
      return;
    }

    try {
      const layout = parseLayout(rootPath);
      treeProvider.setLayout(layout);
      await context.workspaceState.update('ociExplorer.rootPath', rootPath);
      if (getNavigationPreferences().showWebview) {
        panelController.show(layout, preferredKey || undefined);
      } else {
        panelController.setFocus(layout, preferredKey || undefined);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
    }
  };

  const initialPath = context.workspaceState.get<string>('ociExplorer.rootPath');
  if (initialPath) {
    void refreshFromPath(initialPath);
  }

  scheduleLayoutFolderContextUpdate();
  applyNavigationPreferences();

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
    { dispose: () => contextUpdateTimer && clearTimeout(contextUpdateTimer) },
    vscode.workspace.onDidChangeWorkspaceFolders(scheduleLayoutFolderContextUpdate),
    vscode.commands.registerCommand('ociExplorer.openLayout', async (resource?: vscode.Uri) => {
      const rootPath = resource && typeof resource.fsPath === 'string'
        ? resource.fsPath
        : await promptForLayoutFolder();
      if (rootPath) {
        await refreshFromPath(rootPath);
      }
    }),
    vscode.commands.registerCommand('ociExplorer.openLayoutFromExplorer', async (resource?: vscode.Uri) => {
      await vscode.commands.executeCommand('ociExplorer.openLayout', resource);
    }),
    vscode.commands.registerCommand('ociExplorer.refresh', async () => {
      const rootPath = context.workspaceState.get<string>('ociExplorer.rootPath');
      if (rootPath) {
        await refreshFromPath(rootPath, panelController.focusKey);
      }
    }),
    vscode.commands.registerCommand('ociExplorer.focusNode', async (nodeKey: string) => {
      if (!treeProvider.layout || !treeProvider.layout.nodesByKey[nodeKey]) {
        return;
      }
      if (getNavigationPreferences().showWebview) {
        panelController.show(treeProvider.layout, nodeKey);
      } else {
        panelController.setFocus(treeProvider.layout, nodeKey);
      }
    }),
    vscode.commands.registerCommand('ociExplorer.openRawFile', async (node?: LayoutNode) => {
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
        if (getNavigationPreferences().showWebview) {
          panelController.show(treeProvider.layout, node.key);
        } else {
          panelController.setFocus(treeProvider.layout, node.key);
        }
      }
    }),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration(`ociExplorer.${NAVIGATION_MODE_SETTING}`)) {
        return;
      }

      applyNavigationPreferences();
      const rootPath = context.workspaceState.get<string>('ociExplorer.rootPath');
      if (!rootPath) {
        return;
      }

      if (getNavigationPreferences().showWebview) {
        await refreshFromPath(rootPath, panelController.focusKey);
      }
    })
  );
}

export function deactivate(): void {}
