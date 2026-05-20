const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { digestToPath, parseLayout } = require('../src/ociLayout');

const fixturePath = path.join(__dirname, 'fixtures', 'sample-layout');
const richFixturePath = path.join(__dirname, 'fixtures', 'rich-layout');

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
  assert.equal(configNode.label, 'runtime config • linux/amd64');

  const layerNode = layout.nodesByKey[manifestNode.children[1].key];
  assert.equal(layerNode.kind, 'layer');
  assert.equal(layerNode.label, 'layer • app/bin/demo');
  assert.match(layerNode.filePath, /blobs[\\/]+sha256[\\/]+3333333333333333333333333333333333333333333333333333333333333333$/);
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
  assert.equal(attestationNode.label, 'attestation manifest');
});
