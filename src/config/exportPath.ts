import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

function getExportDir(): string {
  return vscode.workspace.getConfiguration('ociExplorer.docker').get<string>('exportPath', '');
}

async function promptForExportDir(): Promise<string | undefined> {
  const TEMP_LABEL = 'Use temporary folder';
  const CHOOSE_LABEL = 'Choose folder…';

  const choice = await vscode.window.showQuickPick(
    [
      { label: TEMP_LABEL, description: os.tmpdir() },
      { label: CHOOSE_LABEL }
    ],
    { placeHolder: 'Where should exported OCI layouts be saved?', ignoreFocusOut: true }
  );

  if (!choice) {
    return undefined;
  }

  let dir: string;
  if (choice.label === TEMP_LABEL) {
    dir = '';
  } else {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select Export Folder'
    });
    if (!selected || !selected[0]) {
      return undefined;
    }
    dir = selected[0].fsPath;
  }

  const DONT_SAVE = "Don't save";
  const WORKSPACE = 'This workspace';
  const USER = 'All workspaces (user settings)';

  const saveChoice = await vscode.window.showQuickPick(
    [
      { label: DONT_SAVE, description: 'Ask again next time' },
      { label: WORKSPACE, description: 'Save in workspace settings' },
      { label: USER, description: 'Save in user settings' }
    ],
    { placeHolder: 'Remember this choice?', ignoreFocusOut: true }
  );

  if (!saveChoice) {
    return undefined;
  }

  if (saveChoice.label === WORKSPACE) {
    await vscode.workspace.getConfiguration('ociExplorer.docker').update('exportPath', dir, vscode.ConfigurationTarget.Workspace);
  } else if (saveChoice.label === USER) {
    await vscode.workspace.getConfiguration('ociExplorer.docker').update('exportPath', dir, vscode.ConfigurationTarget.Global);
  }

  if (dir) {
    await offerGitignore(dir);
  }

  return dir;
}

async function offerGitignore(exportDir: string): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    return;
  }

  for (const folder of workspaceFolders) {
    const rootPath = folder.uri.fsPath;
    const relativePath = path.relative(rootPath, exportDir);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      continue;
    }

    const gitignorePath = path.join(rootPath, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      continue;
    }

    const entry = `/${relativePath.replace(/\\/g, '/')}/`;
    const content = fs.readFileSync(gitignorePath, 'utf8');
    if (content.includes(entry) || content.includes(entry.slice(0, -1))) {
      return;
    }

    const answer = await vscode.window.showInformationMessage(
      `Add ${entry} to .gitignore?`,
      'Yes',
      'No'
    );

    if (answer === 'Yes') {
      const newline = content.endsWith('\n') ? '' : '\n';
      fs.appendFileSync(gitignorePath, `${newline}${entry}\n`);
    }
    return;
  }
}

export async function resolveExportDir(): Promise<string> {
  let configuredDir = getExportDir();
  const config = vscode.workspace.getConfiguration('ociExplorer.docker');
  const inspect = config.inspect<string>('exportPath');
  const hasExplicitSetting = Boolean(
    inspect && (
      inspect.workspaceValue !== undefined
      || inspect.workspaceFolderValue !== undefined
      || inspect.globalValue !== undefined
    )
  );

  if (!hasExplicitSetting) {
    const chosen = await promptForExportDir();
    if (chosen === undefined) {
      throw new Error('Export cancelled.');
    }
    configuredDir = chosen;
  }

  return configuredDir;
}
