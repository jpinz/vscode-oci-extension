import * as path from 'node:path';
import * as vscode from 'vscode';
import { CONTEXT_UPDATE_DEBOUNCE_MS } from './constants';
import { OciBlobEditorProvider } from './customEditor';
import { exportImageToOciLayout } from './dockerExport';
import { DockerImageNode, DockerImageTreeProvider } from './dockerTree';
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
  const containerToolsActive = vscode.extensions.getExtension('ms-azuretools.vscode-containers') !== undefined;
  void vscode.commands.executeCommand('setContext', 'ociExplorer.containerToolsActive', containerToolsActive);

  const treeProvider = new OciTreeProvider();
  const editorProvider = new OciBlobEditorProvider();
  let contextUpdateTimer: ReturnType<typeof setTimeout> | null = null;

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      OciBlobEditorProvider.viewType,
      editorProvider,
      { supportsMultipleEditorsPerDocument: false }
    )
  );

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

  const layoutViewId = containerToolsActive ? 'ociExplorer.layout.integrated' : 'ociExplorer.layout';

  const refreshFromPath = async (rootPath: string | undefined): Promise<void> => {
    if (!rootPath) {
      treeProvider.setLayout(null);
      return;
    }

    treeProvider.setLoading();

    try {
      const layout = await vscode.window.withProgress(
        { location: { viewId: layoutViewId } },
        async () => parseLayout(rootPath)
      );
      treeProvider.setLayout(layout);
      editorProvider.refreshAll(layout);
      await context.workspaceState.update('ociExplorer.rootPath', rootPath);
    } catch (error) {
      treeProvider.setLayout(null);
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(message);
    }
  };

  const initialPath = context.workspaceState.get<string>('ociExplorer.rootPath');
  if (initialPath) {
    void refreshFromPath(initialPath);
  }

  editorProvider.onFocusNode((nodeKey: string) => {
    const treeNode = treeProvider.findNode(nodeKey);
    if (treeNode) {
      void treeView.reveal(treeNode, { select: true, expand: true });
    }
    if (treeNode && treeNode.filePath) {
      void vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(treeNode.filePath));
    }
  });

  scheduleLayoutFolderContextUpdate();

  const treeView = vscode.window.createTreeView(layoutViewId, {
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
        await refreshFromPath(rootPath);
      }
    }),
    vscode.commands.registerCommand('ociExplorer.openRawFile', async (node?: LayoutNode) => {
      if (node && node.filePath) {
        await openNodeFile(node);
      }
    }),
    vscode.commands.registerCommand('ociExplorer.focusNode', async (nodeKey: string) => {
      if (!treeProvider.layout) {
        return;
      }
      const node = treeProvider.layout.nodesByKey[nodeKey];
      if (node && node.filePath) {
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(node.filePath),
          OciBlobEditorProvider.viewType
        );
      }
    }),
    treeView.onDidChangeSelection(async (event) => {
      const [node] = event.selection;
      if (node && 'filePath' in node && node.filePath) {
        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(node.filePath),
          OciBlobEditorProvider.viewType
        );
      }
    })
  );

  // Docker images tree view (only when Container Tools is not installed)
  if (!containerToolsActive) {
    const dockerTreeProvider = new DockerImageTreeProvider();
    const dockerTreeView = vscode.window.createTreeView('ociExplorer.dockerImages', {
      treeDataProvider: dockerTreeProvider,
      showCollapseAll: false
    });

    dockerTreeView.onDidChangeVisibility((e) => {
      if (e.visible && dockerTreeProvider.getError() !== null) {
        void dockerTreeProvider.refresh();
      }
    });

    void dockerTreeProvider.refresh();

    context.subscriptions.push(
      dockerTreeView,
      vscode.commands.registerCommand('ociExplorer.docker.refresh', () => dockerTreeProvider.refresh())
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('ociExplorer.docker.openAsOciLayout', async (node?: unknown) => {
      if (!node || typeof node !== 'object') {
        return;
      }

      const item = node as Record<string, unknown>;
      const reference = typeof item.reference === 'string'
        ? item.reference
        : typeof item.fullTag === 'string'
          ? item.fullTag
          : null;

      if (!reference) {
        void vscode.window.showErrorMessage('Could not determine image reference.');
        return;
      }

      try {
        const outputDir = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Exporting ${reference} to OCI layout…`,
            cancellable: false
          },
          () => exportImageToOciLayout(reference)
        );

        await refreshFromPath(outputDir);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Failed to export image: ${message}`);
      }
    })
  );
}

export function deactivate(): void {}
