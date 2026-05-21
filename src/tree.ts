import * as vscode from 'vscode';
import { LayoutNode, ParsedLayout } from './ociLayout';

export interface EmptyNode {
  key: string;
  label: string;
  kind: 'info';
  children: [];
  filePath: null;
}

export type TreeNode = LayoutNode | EmptyNode;

class LayoutTreeItem extends vscode.TreeItem {
  readonly node: TreeNode;

  constructor(node: TreeNode) {
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

export class OciTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  layout: ParsedLayout | null = null;

  setLayout(layout: ParsedLayout | null): void {
    this.layout = layout;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return new LayoutTreeItem(element);
  }

  getChildren(element?: TreeNode): Thenable<TreeNode[]> {
    if (!this.layout) {
      return Promise.resolve([
        {
          key: 'empty',
          label: 'Open an OCI layout folder',
          kind: 'info',
          children: [],
          filePath: null
        }
      ]);
    }

    if (!element) {
      return Promise.resolve(this.layout.roots.map((key) => this.layout!.nodesByKey[key]));
    }

    return Promise.resolve((element.children || []).map((child) => this.layout!.nodesByKey[child.key]));
  }

  getParent(element: TreeNode): TreeNode | undefined {
    if (!this.layout) {
      return undefined;
    }

    for (const node of this.layout.nodes) {
      if (node.children.some((child) => child.key === element.key)) {
        return node;
      }
    }

    return undefined;
  }

  findNode(key: string): TreeNode | undefined {
    return this.layout ? this.layout.nodesByKey[key] : undefined;
  }
}

function describeNode(node: TreeNode): string {
  const details = [node.kind];
  if ('name' in node && node.name && !getNodePrimaryName(node).includes(node.name)) {
    details.push(node.name);
  }
  if ('mediaType' in node && node.mediaType) {
    details.push(node.mediaType.replace(/^application\/vnd\./, ''));
  }
  if ('digest' in node && node.digest) {
    details.push(node.digest.slice(0, 19));
  }
  return details.join(' • ');
}

function getTooltip(node: TreeNode): string {
  const lines = [`**${node.label}**`, '', `Kind: \`${node.kind}\``];
  if ('mediaType' in node && node.mediaType) {
    lines.push(`Media type: \`${node.mediaType}\``);
  }
  if ('digest' in node && node.digest) {
    lines.push(`Digest: \`${node.digest}\``);
  }
  if (node.filePath) {
    lines.push(`File: \`${node.filePath}\``);
  }
  return lines.join('\n\n');
}

function getIcon(kind: string): vscode.ThemeIcon {
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

function getNodePrimaryName(node: Pick<LayoutNode, 'displayName' | 'name'>): string {
  return node.displayName || node.name;
}
