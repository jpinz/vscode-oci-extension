import * as vscode from 'vscode';
import { LayoutNode } from './ociLayout';
import { toOciBlobUri } from './ociBlobContentProvider';
import { TreeNode } from './tree';

export async function openNodeFile(node?: LayoutNode | null): Promise<void> {
  if (!node || !node.filePath) {
    return;
  }

  const uri = isJsonNode(node) ? toOciBlobUri(node.filePath) : vscode.Uri.file(node.filePath);
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, { preview: false });
}

function isJsonNode(node?: LayoutNode | TreeNode | null): boolean {
  if (!node) {
    return false;
  }

  if ('json' in node && (node.json || node.parseError)) {
    return true;
  }

  if ('name' in node && typeof node.name === 'string' && node.name.endsWith('.json')) {
    return true;
  }

  return 'mediaType' in node && typeof node.mediaType === 'string' && node.mediaType.includes('json');
}
