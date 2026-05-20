import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { digestToPath, isOciLayoutFolder, parseLayout } from '../ociLayout';

const fixturePath = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'sample-layout');
const richFixturePath = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'rich-layout');
const attestationFixturePath = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'attestation-layout');

test('digestToPath maps blob digests into OCI blob paths', () => {
	assert.equal(
		digestToPath('/tmp/layout', 'sha256:abc123'),
		path.join('/tmp/layout', 'blobs', 'sha256', 'abc123')
	);
});

test('parseLayout links the image index, manifest, config, and layers', () => {
	const layout = parseLayout(fixturePath);

	assert.equal(layout.layoutVersion, '1.0.0');
	assert.deepEqual(layout.roots, ['layout-file', 'index-file']);
	assert.equal(Object.keys(layout.nodesByKey).length, 5);

	const indexNode = layout.nodesByKey['index-file'];
	assert.equal(indexNode.children.length, 1);
	assert.equal(indexNode.children[0].relation, 'manifest');

	const manifestNode = layout.nodesByKey[indexNode.children[0].key];
	assert.equal(manifestNode.kind, 'image-manifest');
	assert.equal(manifestNode.label, 'demo:v1 • linux/amd64');
	assert.equal(manifestNode.name, 'manifest');
	assert.equal(manifestNode.children.length, 2);

	const configNode = layout.nodesByKey[manifestNode.children[0].key];
	assert.equal(configNode.kind, 'config');
	assert.equal(configNode.label, 'image config • linux/amd64');

	const layerNode = layout.nodesByKey[manifestNode.children[1].key];
	assert.equal(layerNode.kind, 'layer');
	assert.equal(layerNode.label, 'layer • app/bin/demo');
	assert.match(layerNode.filePath || '', /blobs[\\/]+sha256[\\/]+3333333333333333333333333333333333333333333333333333333333333333$/);
});

test('parseLayout uses attestation and image index annotations in labels', () => {
	const layout = parseLayout(richFixturePath);
	const indexNode = layout.nodesByKey['index-file'];

	assert.equal(indexNode.children.length, 2);
	assert.equal(indexNode.children[0].relation, 'manifest');
	assert.equal(indexNode.children[1].relation, 'manifest');

	const nestedIndexNode = layout.nodesByKey[indexNode.children[0].key];
	assert.equal(nestedIndexNode.kind, 'image-index');
	assert.equal(nestedIndexNode.label, 'demo:nested');

	const attestationNode = layout.nodesByKey[indexNode.children[1].key];
	assert.equal(attestationNode.kind, 'image-manifest');
	assert.equal(attestationNode.label, 'attestation manifest • https://spdx.dev/Document');
});

test('isOciLayoutFolder requires layout markers and the blobs directory', () => {
	const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oci-layout-test-'));
	try {
		assert.equal(isOciLayoutFolder(tempRoot), false);
		assert.throws(() => parseLayout(tempRoot), /is not an OCI layout folder/);

		fs.writeFileSync(path.join(tempRoot, 'oci-layout'), '{"imageLayoutVersion":"1.0.0"}');
		assert.equal(isOciLayoutFolder(tempRoot), false);

		fs.writeFileSync(path.join(tempRoot, 'index.json'), '{"schemaVersion":2,"manifests":[]}');
		assert.equal(isOciLayoutFolder(tempRoot), false);
		assert.throws(() => parseLayout(tempRoot), /is not an OCI layout folder/);

		fs.mkdirSync(path.join(tempRoot, 'blobs'));
		assert.equal(isOciLayoutFolder(tempRoot), true);
	} finally {
		fs.rmSync(tempRoot, { recursive: true, force: true });
	}
});

test('parseLayout categorizes in-toto statements and docker configs for display labels', () => {
	const layout = parseLayout(attestationFixturePath);
	const indexNode = layout.nodesByKey['index-file'];
	const labels = indexNode.children.map((child) => layout.nodesByKey[child.key].label);

	assert.deepEqual(labels, [
		'slsa provenance • linux/amd64',
		'sbom (spdx) • linux/arm64',
		'sbom (cyclonedx)',
		'Trivy Vulnerability Report',
		'image config • linux/s390x'
	]);
});
