import * as vscode from 'vscode';
import { getKindDisplayLabel, LayoutNode, ParsedLayout } from './ociLayout';

export interface EmptyNode {
  key: string;
  label: string;
  kind: 'info';
  children: [];
  filePath: null;
}

export interface WarningNode {
  key: string;
  label: string;
  kind: 'warning';
  children: [];
  filePath: null;
  commandId?: string;
}

export type TreeNode = LayoutNode | EmptyNode | WarningNode;

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

    if (node.kind === 'warning') {
      this.contextValue = 'ociPrerequisiteMissing';
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
      const warningNode = node as WarningNode;
      if (warningNode.commandId) {
        this.command = {
          command: warningNode.commandId,
          title: 'Show OCI Layout Prerequisites'
        };
      }
      return;
    }

    this.contextValue = node.filePath ? 'ociNode' : 'ociInfo';
    this.description = describeNode(node);
    this.tooltip = new vscode.MarkdownString(getTooltip(node));
    this.iconPath = getIcon(node.kind);

    if (node.filePath) {
      this.command = {
        command: 'ociExplorer.openRawFile',
        title: 'Open OCI File',
        arguments: [node]
      };
    }
  }
}

export class OciTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  layout: ParsedLayout | null = null;
  private loading = false;
  private orasMissing = false;

  setLayout(layout: ParsedLayout | null): void {
    this.layout = layout;
    this.loading = false;
    this.refresh();
  }

  setLoading(): void {
    this.loading = true;
    this.refresh();
  }

  setOrasMissing(missing: boolean): void {
    if (this.orasMissing === missing) {
      return;
    }
    this.orasMissing = missing;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return new LayoutTreeItem(element);
  }

  getChildren(element?: TreeNode): Thenable<TreeNode[]> {
    if (element) {
      if (element.kind === 'info' || element.kind === 'warning' || !this.layout) {
        return Promise.resolve([]);
      }
      const layoutNode = element as LayoutNode;
      const children = layoutNode.children
        .map((child) => this.layout?.nodesByKey[child.key])
        .filter((n): n is LayoutNode => Boolean(n));
      return Promise.resolve(children);
    }

    const roots: TreeNode[] = [];

    if (this.orasMissing) {
      roots.push({
        key: 'prerequisite',
        label: 'ORAS is required to export images to an OCI layout. Click to learn more.',
        kind: 'warning',
        children: [],
        filePath: null,
        commandId: 'ociExplorer.showPrerequisitesHelp'
      });
    }

    if (this.loading) {
      roots.push({
        key: 'loading',
        label: '$(loading~spin) Loading layout…',
        kind: 'info' as const,
        children: [] as [],
        filePath: null
      });
      return Promise.resolve(roots);
    }

    if (!this.layout) {
      roots.push({
        key: 'empty',
        label: 'Use Explore Image to open a folder or pull/export an image',
        kind: 'info',
        children: [],
        filePath: null
      });
      return Promise.resolve(roots);
    }

    roots.push(...this.layout.roots.map((key) => this.layout!.nodesByKey[key]));
    return Promise.resolve(roots);
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
  if (node.kind === 'info' || node.kind === 'warning') {
    return '';
  }

  const layoutNode = node as LayoutNode;
  const details: string[] = [getKindDisplayLabel(layoutNode.kind)];
  if (layoutNode.name && !getNodePrimaryName(layoutNode).includes(layoutNode.name)) {
    details.push(layoutNode.name);
  }
  if (layoutNode.mediaType) {
    details.push(layoutNode.mediaType.replace(/^application\/vnd\./, ''));
  }
  if (layoutNode.digest) {
    details.push(layoutNode.digest.slice(0, 19));
  }
  return details.join(' • ');
}

function getTooltip(node: TreeNode): string {
  const lines = [`**${node.label}**`, '', `Kind: \`${getKindDisplayLabel(node.kind)}\``];
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
