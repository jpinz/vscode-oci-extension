const fs = require('node:fs');
const path = require('node:path');

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return { __parseError: error.message };
  }
}

function digestToPath(rootPath, digest) {
  if (!digest || typeof digest !== 'string' || !digest.includes(':')) {
    return null;
  }

  const [algorithm, encoded] = digest.split(':', 2);
  if (!algorithm || !encoded) {
    return null;
  }

  return path.join(rootPath, 'blobs', algorithm, encoded);
}

function getReadableKind(mediaType, json) {
  if (json && Array.isArray(json.manifests)) {
    return 'image-index';
  }

  if (json && json.config && Array.isArray(json.layers)) {
    return 'image-manifest';
  }

  if (mediaType && mediaType.includes('config')) {
    return 'config';
  }

  if (mediaType && mediaType.includes('layer')) {
    return 'layer';
  }

  if (mediaType && mediaType.includes('index')) {
    return 'image-index';
  }

  if (mediaType && mediaType.includes('manifest')) {
    return 'image-manifest';
  }

  return 'blob';
}

function joinLabelParts(parts) {
  return parts.filter(Boolean).join(' • ');
}

function getPlatformLabel(source) {
  if (!source || typeof source !== 'object' || (!source.os && !source.architecture)) {
    return null;
  }

  const variant = source.variant ? `/${source.variant}` : '';
  return `${source.os || 'unknown'}/${source.architecture || 'unknown'}${variant}`;
}

function getHumanReadableName(node) {
  if (node.kind === 'image-manifest') {
    return joinLabelParts([
      node.annotations && node.annotations['org.opencontainers.image.ref.name'],
      getPlatformLabel(node.platform)
    ]) || node.name;
  }

  if (node.kind === 'config') {
    return joinLabelParts([
      'runtime config',
      getPlatformLabel(node.json)
    ]) || node.name;
  }

  if (node.kind === 'layer') {
    return node.annotations && node.annotations['org.opencontainers.image.title']
      ? `layer • ${node.annotations['org.opencontainers.image.title']}`
      : node.name;
  }

  return node.name;
}

function getNodeLabel(node) {
  if (node.displayName) {
    return node.displayName;
  }

  if (node.name) {
    return node.name;
  }

  if (node.digest) {
    return `${node.kind} ${node.digest.slice(0, 19)}…`;
  }

  return node.kind;
}

function isDescriptor(value) {
  return Boolean(value && typeof value === 'object' && typeof value.digest === 'string');
}

function createDescriptorNode(rootPath, descriptor, relationLabel, nodesByKey, traversalStack) {
  const digest = descriptor && descriptor.digest;
  const key = digest ? `descriptor:${digest}` : `${relationLabel}:${Math.random().toString(16).slice(2)}`;
  if (nodesByKey.has(key)) {
    return key;
  }

  const filePath = digestToPath(rootPath, digest);
  const exists = Boolean(filePath && fs.existsSync(filePath));
  const json = exists ? safeReadJson(filePath) : null;
  const node = {
    key,
    name: relationLabel,
    relationLabel,
    kind: getReadableKind(descriptor.mediaType, json && !json.__parseError ? json : null),
    digest,
    mediaType: descriptor.mediaType || null,
    size: descriptor.size || null,
    annotations: descriptor.annotations || null,
    artifactType: descriptor.artifactType || null,
    platform: descriptor.platform || null,
    filePath,
    exists,
    json: json && !json.__parseError ? json : null,
    parseError: json && json.__parseError ? json.__parseError : null,
    children: []
  };

  nodesByKey.set(key, node);

  if (!exists || !node.json || traversalStack.has(key)) {
    return key;
  }

  traversalStack.add(key);

  const childDescriptors = [];
  if (Array.isArray(node.json.manifests)) {
    node.json.manifests.forEach((childDescriptor, index) => {
      childDescriptors.push({
        relation: `manifest ${index + 1}`,
        descriptor: childDescriptor
      });
    });
  }

  if (isDescriptor(node.json.config)) {
    childDescriptors.push({
      relation: 'config',
      descriptor: node.json.config
    });
  }

  if (Array.isArray(node.json.layers)) {
    node.json.layers.filter(isDescriptor).forEach((childDescriptor, index) => {
      childDescriptors.push({
        relation: `layer ${index + 1}`,
        descriptor: childDescriptor
      });
    });
  }

  if (isDescriptor(node.json.subject)) {
    childDescriptors.push({
      relation: 'subject',
      descriptor: node.json.subject
    });
  }

  childDescriptors.forEach(({ relation, descriptor }) => {
    const childKey = createDescriptorNode(rootPath, descriptor, relation, nodesByKey, traversalStack);
    node.children.push({
      relation,
      key: childKey
    });
  });

  traversalStack.delete(key);
  return key;
}

function parseLayout(rootPath) {
  const layoutPath = path.join(rootPath, 'oci-layout');
  const indexPath = path.join(rootPath, 'index.json');

  if (!fs.existsSync(layoutPath) || !fs.existsSync(indexPath)) {
    throw new Error(`'${rootPath}' is not an OCI layout folder.`);
  }

  const layoutJson = safeReadJson(layoutPath);
  const indexJson = safeReadJson(indexPath);
  const nodesByKey = new Map();
  const traversalStack = new Set();

  const layoutNode = {
    key: 'layout-file',
    name: 'oci-layout',
    kind: 'layout',
    filePath: layoutPath,
    exists: true,
    json: layoutJson.__parseError ? null : layoutJson,
    parseError: layoutJson.__parseError || null,
    children: []
  };

  const indexNode = {
    key: 'index-file',
    name: 'index.json',
    kind: 'image-index',
    filePath: indexPath,
    exists: true,
    json: indexJson.__parseError ? null : indexJson,
    parseError: indexJson.__parseError || null,
    children: []
  };

  nodesByKey.set(layoutNode.key, layoutNode);
  nodesByKey.set(indexNode.key, indexNode);

  const topLevelDescriptors = Array.isArray(indexNode.json && indexNode.json.manifests)
    ? indexNode.json.manifests
    : [];

  topLevelDescriptors.forEach((descriptor, index) => {
    const childKey = createDescriptorNode(rootPath, descriptor, `manifest ${index + 1}`, nodesByKey, traversalStack);
    indexNode.children.push({
      relation: `manifest ${index + 1}`,
      key: childKey
    });
  });

  const nodes = Array.from(nodesByKey.values()).map((node) => {
    const enrichedNode = {
      ...node,
      displayName: getHumanReadableName(node)
    };

    return {
      ...enrichedNode,
      label: getNodeLabel(enrichedNode)
    };
  });

  return {
    rootPath,
    layoutPath,
    indexPath,
    layoutVersion: layoutNode.json && layoutNode.json.imageLayoutVersion ? layoutNode.json.imageLayoutVersion : null,
    nodes,
    nodesByKey: Object.fromEntries(nodes.map((node) => [node.key, node])),
    roots: [layoutNode.key, indexNode.key]
  };
}

module.exports = {
  digestToPath,
  parseLayout
};
