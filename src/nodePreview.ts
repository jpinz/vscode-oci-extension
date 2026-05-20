import * as vscode from 'vscode';
import { LayoutNode } from './ociLayout';
import { TreeNode } from './tree';

export async function openNodeFile(node?: LayoutNode | null): Promise<void> {
  if (!node || !node.filePath) {
    return;
  }

  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(node.filePath));
  await vscode.window.showTextDocument(document, { preview: false });
}

export function isJsonNode(node?: LayoutNode | TreeNode | null): boolean {
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

export async function openNodePreview(node?: LayoutNode | null): Promise<void> {
  if (!node || !node.filePath) {
    return;
  }

  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(node.filePath));
  if (isJsonNode(node) && document.languageId !== 'json') {
    await vscode.languages.setTextDocumentLanguage(document, 'json');
  }

  await vscode.window.showTextDocument(document, {
    preview: true,
    preserveFocus: true,
    viewColumn: vscode.ViewColumn.Beside
  });
}
