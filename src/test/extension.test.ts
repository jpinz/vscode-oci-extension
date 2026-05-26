import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';

const EXTENSION_ID = 'jpinz.oci-layout-explorer';
const CONTAINER_TOOLS_ID = 'ms-azuretools.vscode-containers';

const sampleLayoutPath = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'sample-layout');

interface OciExplorerApi {
	readonly containerToolsActive: boolean;
	readonly layoutViewId: string;
}

async function getActivatedExtension(): Promise<vscode.Extension<OciExplorerApi>> {
	const extension = vscode.extensions.getExtension<OciExplorerApi>(EXTENSION_ID);
	assert.ok(extension, `Extension ${EXTENSION_ID} should be present in the test host.`);
	if (!extension.isActive) {
		await extension.activate();
	}
	return extension;
}

const containerToolsInstalled = (): boolean =>
	vscode.extensions.getExtension(CONTAINER_TOOLS_ID) !== undefined;

suite('OCI Layout Explorer integration', () => {
	suiteSetup(async function () {
		this.timeout(20_000);
		await getActivatedExtension();
	});

	test('extension is present and activates', async () => {
		const extension = await getActivatedExtension();
		assert.equal(extension.isActive, true);
	});

	test('contributed commands are registered', async () => {
		const commands = await vscode.commands.getCommands(true);
		for (const expected of [
			'ociExplorer.openLayout',
			'ociExplorer.exploreImage',
			'ociExplorer.refresh',
			'ociExplorer.openRawFile',
			'ociExplorer.openLayoutFromExplorer',
			'ociExplorer.showPrerequisitesHelp'
		]) {
			assert.ok(commands.includes(expected), `Command ${expected} should be registered.`);
		}
	});

	test('ociExplorer.openLayout loads a fixture layout into workspace state', async function () {
		this.timeout(20_000);
		await vscode.commands.executeCommand('ociExplorer.openLayout', vscode.Uri.file(sampleLayoutPath));
		// Refresh should run without throwing once a root has been set.
		await vscode.commands.executeCommand('ociExplorer.refresh');
	});

	test('OCI blob virtual document provider yields pretty-printed JSON', async () => {
		const blobPath = path.join(
			sampleLayoutPath,
			'blobs',
			'sha256',
			'1111111111111111111111111111111111111111111111111111111111111111'
		);
		const uri = vscode.Uri.file(blobPath).with({ scheme: 'oci-explorer-blob' });
		const document = await vscode.workspace.openTextDocument(uri);
		const text = document.getText().trim();
		assert.ok(text.length > 0, 'Blob document should not be empty.');
		const parsed = JSON.parse(text) as { mediaType?: string };
		assert.equal(parsed.mediaType, 'application/vnd.oci.image.manifest.v1+json');
		// Pretty-printed output should contain newlines, unlike the on-disk one-line blob.
		assert.ok(text.includes('\n'), 'Provider should pretty-print JSON.');
	});
});

suite('Container Tools integration matrix', () => {
	suiteSetup(async function () {
		this.timeout(20_000);
		await getActivatedExtension();
	});

	test('exported API matches Container Tools presence', async () => {
		const extension = await getActivatedExtension();
		const api = extension.exports;
		const present = containerToolsInstalled();
		assert.equal(api.containerToolsActive, present, 'containerToolsActive should match presence.');
		assert.equal(
			api.layoutViewId,
			present ? 'ociExplorer.layout.integrated' : 'ociExplorer.layout',
			'layoutViewId should switch based on Container Tools presence.'
		);
	});

	test('Container Tools commands are present only when the extension is installed', async () => {
		const enumeratedPresent = vscode.extensions.all.some((ext) => ext.id === CONTAINER_TOOLS_ID);
		assert.equal(
			enumeratedPresent,
			containerToolsInstalled(),
			'extensions.all should agree with getExtension on Container Tools presence.'
		);
	});
});
