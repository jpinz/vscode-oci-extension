import * as path from 'node:path';
import * as vscode from 'vscode';
import { CONTEXT_UPDATE_DEBOUNCE_MS } from './constants';
import { OciBlobEditorProvider } from './customEditor';
import { exportImageToOciLayout } from './dockerExport';
import { listImages } from './docker';
import { DockerImageNode, DockerImageTreeProvider } from './dockerTree';
import { LayoutNode, parseLayout } from './ociLayout';
import { openNodeFile } from './nodePreview';
import { OciTreeProvider } from './tree';

const DEFAULT_JSON_DETECTION_MAX_BYTES = 8 * 1024 * 1024;
const JSON_DETECTION_MAX_BYTES_SETTING = 'jsonDetectionMaxBytes';

function getJsonDetectionMaxBytes(): number {
  const configured = vscode.workspace
    .getConfiguration('ociExplorer')
    .get<number>(JSON_DETECTION_MAX_BYTES_SETTING, DEFAULT_JSON_DETECTION_MAX_BYTES);

  if (typeof configured !== 'number' || !Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_JSON_DETECTION_MAX_BYTES;
  }

  return Math.floor(configured);
}

function isLikelyOciDescriptorPath(fsPath: string): boolean {
  const normalized = fsPath.replace(/\\/g, '/');
  if (normalized.endsWith('/index.json') || normalized.endsWith('/oci-layout')) {
    return true;
  }

  return /\/blobs\/[^/]+\/[^/]+$/.test(normalized);
}

function isJsonDocumentContent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  const firstChar = trimmed[0];
  if (firstChar !== '{' && firstChar !== '[') {
    return false;
  }

  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

async function ensureJsonLanguageForOciDocument(document: vscode.TextDocument): Promise<void> {
  if (document.uri.scheme !== 'file') {
    return;
  }

  if (document.languageId === 'json' || !isLikelyOciDescriptorPath(document.uri.fsPath)) {
    return;
  }

  try {
    const stat = await vscode.workspace.fs.stat(document.uri);
    if (stat.size > getJsonDetectionMaxBytes()) {
      return;
    }
  } catch {
    return;
  }

  if (!isJsonDocumentContent(document.getText())) {
    return;
  }

  await vscode.languages.setTextDocumentLanguage(document, 'json');
}

async function promptForLayoutFolder(): Promise<string | null> {
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Open OCI Layout Folder'
  });

  return selected && selected[0] ? selected[0].fsPath : null;
}

type ExploreImageMode = 'folder' | 'daemon' | 'registry';

async function promptForExploreMode(): Promise<ExploreImageMode | null> {
  const selection = await vscode.window.showQuickPick(
    [
      { label: 'Open OCI layout folder', mode: 'folder' as const },
      { label: 'Use image from Docker daemon', mode: 'daemon' as const },
      { label: 'Pull image from registry', mode: 'registry' as const }
    ],
    {
      placeHolder: 'Explore Image: choose an image source',
      ignoreFocusOut: true
    }
  );

  return selection?.mode ?? null;
}

async function promptForDaemonImageReference(): Promise<string | null> {
  const rawImages = await listImages();
  const references: string[] = [];

  for (const image of rawImages) {
    const tags = image.RepoTags ?? [];
    if (tags.length === 0 || (tags.length === 1 && tags[0] === '<none>:<none>')) {
      references.push(image.Id);
      continue;
    }

    for (const tag of tags) {
      references.push(tag);
    }
  }

  const items = Array.from(new Set(references)).sort((a, b) => a.localeCompare(b)).map((reference) => ({
    label: reference
  }));

  if (items.length === 0) {
    throw new Error('No Docker images were found in the daemon.');
  }

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a Docker image to export as an OCI layout',
    ignoreFocusOut: true,
    matchOnDescription: true,
    matchOnDetail: true
  });

  return selected?.label ?? null;
}

async function promptForRegistryReference(): Promise<string | null> {
  const value = await vscode.window.showInputBox({
    title: 'Pull image from registry',
    prompt: 'Enter a full image reference (for example ghcr.io/org/image:tag)',
    placeHolder: 'registry/repository[:tag]|[@digest]',
    ignoreFocusOut: true,
    validateInput: (input) => input.trim() ? null : 'Image reference is required.'
  });

  return value?.trim() || null;
}

export function activate(context: vscode.ExtensionContext): void {
  const containerToolsActive = vscode.extensions.getExtension('ms-azuretools.vscode-containers') !== undefined;
  void vscode.commands.executeCommand('setContext', 'ociExplorer.containerToolsActive', containerToolsActive);

  const treeProvider = new OciTreeProvider();
  const editorProvider = new OciBlobEditorProvider();
  let contextUpdateTimer: ReturnType<typeof setTimeout> | null = null;

  void Promise.all(vscode.workspace.textDocuments.map((document) => ensureJsonLanguageForOciDocument(document)));

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
    vscode.workspace.onDidOpenTextDocument((document) => {
      void ensureJsonLanguageForOciDocument(document);
    }),
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
    vscode.commands.registerCommand('ociExplorer.exploreImage', async () => {
      try {
        const mode = await promptForExploreMode();
        if (!mode) {
          return;
        }

        if (mode === 'folder') {
          const rootPath = await promptForLayoutFolder();
          if (rootPath) {
            await refreshFromPath(rootPath);
          }
          return;
        }

        const reference = mode === 'daemon'
          ? await promptForDaemonImageReference()
          : await promptForRegistryReference();

        if (!reference) {
          return;
        }

        const outputDir = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: mode === 'registry'
              ? `Pulling ${reference} and exporting to OCI layout…`
              : `Exporting ${reference} to OCI layout…`,
            cancellable: false
          },
          () => exportImageToOciLayout(reference, { source: mode === 'registry' ? 'registry' : 'docker-daemon' })
        );

        await refreshFromPath(outputDir);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Explore Image failed: ${message}`);
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
