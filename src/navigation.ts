import * as vscode from 'vscode';
import {
  NAVIGATION_MODE_BOTH,
  NAVIGATION_MODE_SETTING,
  NAVIGATION_MODE_TREE,
  NAVIGATION_MODE_UI
} from './constants';

export interface NavigationPreferences {
  showTreeView: boolean;
  showWebview: boolean;
}

export function getNavigationMode(): string {
  const configuredMode = vscode.workspace.getConfiguration('ociExplorer').get<string>(NAVIGATION_MODE_SETTING);
  if ([NAVIGATION_MODE_TREE, NAVIGATION_MODE_UI, NAVIGATION_MODE_BOTH].includes(configuredMode || '')) {
    return configuredMode as string;
  }

  return NAVIGATION_MODE_BOTH;
}

export function getNavigationPreferences(): NavigationPreferences {
  const mode = getNavigationMode();
  return {
    showTreeView: mode === NAVIGATION_MODE_TREE || mode === NAVIGATION_MODE_BOTH,
    showWebview: mode === NAVIGATION_MODE_UI || mode === NAVIGATION_MODE_BOTH
  };
}
