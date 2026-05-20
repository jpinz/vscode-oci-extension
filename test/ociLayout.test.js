const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { digestToPath, isOciLayoutFolder, parseLayout } = require('../src/ociLayout');

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
  assert.equal(manifestNode.label, 'demo:v1 • linux/amd64');
  assert.equal(manifestNode.children.length, 2);

  const configNode = layout.nodesByKey[manifestNode.children[0].key];
  assert.equal(configNode.kind, 'config');
  assert.equal(configNode.label, 'runtime config • linux/amd64');

  const layerNode = layout.nodesByKey[manifestNode.children[1].key];
  assert.equal(layerNode.kind, 'layer');
  assert.equal(layerNode.label, 'layer • app/bin/demo');
  assert.match(layerNode.filePath, /blobs[\\/]+sha256[\\/]+3333333333333333333333333333333333333333333333333333333333333333$/);
});

test('isOciLayoutFolder requires layout markers and the blobs directory', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'oci-layout-test-'));
  try {
    fs.writeFileSync(path.join(tempRoot, 'oci-layout'), '{"imageLayoutVersion":"1.0.0"}');
    fs.writeFileSync(path.join(tempRoot, 'index.json'), '{"schemaVersion":2,"manifests":[]}');

    assert.equal(isOciLayoutFolder(tempRoot), false);
    assert.throws(() => parseLayout(tempRoot), /is not an OCI layout folder/);

    fs.mkdirSync(path.join(tempRoot, 'blobs'));

    assert.equal(isOciLayoutFolder(tempRoot), true);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
