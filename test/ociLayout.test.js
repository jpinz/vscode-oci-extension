const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { digestToPath, parseLayout } = require('../src/ociLayout');

const fixturePath = path.join(__dirname, 'fixtures', 'sample-layout');

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

  const manifestNode = layout.nodesByKey[indexNode.children[0].key];
  assert.equal(manifestNode.kind, 'image-manifest');
  assert.equal(manifestNode.children.length, 2);

  const configNode = layout.nodesByKey[manifestNode.children[0].key];
  assert.equal(configNode.kind, 'config');

  const layerNode = layout.nodesByKey[manifestNode.children[1].key];
  assert.equal(layerNode.kind, 'layer');
  assert.match(layerNode.filePath, /blobs[\\/]+sha256[\\/]+3333333333333333333333333333333333333333333333333333333333333333$/);
});
