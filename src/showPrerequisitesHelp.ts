import * as path from 'node:path';
import * as vscode from 'vscode';

export async function showPrerequisitesHelp(context: vscode.ExtensionContext): Promise<void> {
  const helpFile = vscode.Uri.file(
    path.join(context.extensionPath, 'resources', 'oci', 'OciPrerequisites.md')
  );
  await vscode.commands.executeCommand('markdown.showPreview', helpFile);
}
