import * as vscode from 'vscode';
import { DockerImage, listImages } from './docker';

export interface DockerImageNode {
  type: 'image';
  image: DockerImage;
  reference: string;
  label: string;
  size: string;
}

export class DockerImageTreeProvider implements vscode.TreeDataProvider<DockerImageNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<DockerImageNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private images: DockerImageNode[] = [];
  private error: string | null = null;

  async refresh(): Promise<void> {
    try {
      const rawImages = await listImages();
      this.images = [];
      this.error = null;

      for (const image of rawImages) {
        const tags = image.RepoTags ?? [];
        if (tags.length === 0 || (tags.length === 1 && tags[0] === '<none>:<none>')) {
          this.images.push({
            type: 'image',
            image,
            reference: image.Id,
            label: image.Id.slice(7, 19) + '…',
            size: formatSize(image.Size),
          });
          continue;
        }

        for (const tag of tags) {
          this.images.push({
            type: 'image',
            image,
            reference: tag,
            label: tag,
            size: formatSize(image.Size),
          });
        }
      }

      this.images.sort((a, b) => a.label.localeCompare(b.label));
    } catch (error) {
      this.images = [];
      this.error = error instanceof Error ? error.message : String(error);
    }

    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: DockerImageNode): vscode.TreeItem {
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.description = element.size;
    item.iconPath = new vscode.ThemeIcon('package');
    item.contextValue = 'dockerImage';
    item.tooltip = new vscode.MarkdownString([
      `**${element.label}**`,
      '',
      `ID: \`${element.image.Id.slice(7, 19)}…\``,
      `Size: ${element.size}`,
      `Created: ${new Date(element.image.Created * 1000).toLocaleString()}`
    ].join('\n\n'));
    return item;
  }

  getChildren(element?: DockerImageNode): DockerImageNode[] {
    if (element) {
      return [];
    }
    return this.images;
  }

  getError(): string | null {
    return this.error;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) { return `${bytes} B`; }
  if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
  if (bytes < 1024 * 1024 * 1024) { return `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
