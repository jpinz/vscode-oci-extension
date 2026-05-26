import { defineConfig } from '@vscode/test-cli';

const common = {
	files: 'out/test/*.test.js',
	mocha: {
		ui: 'tdd',
		timeout: 20000,
	},
};

export default defineConfig([
	{
		...common,
		label: 'integration-standalone',
		// Force Container Tools off even if a previous run installed it into the shared
		// .vscode-test extensions directory, so this scenario always runs without it.
		launchArgs: ['--disable-extension', 'ms-azuretools.vscode-containers'],
	},
	{
		...common,
		label: 'integration-with-container-tools',
		installExtensions: ['ms-azuretools.vscode-containers'],
	},
]);
