const fs = require('node:fs');
const path = require('node:path');

function pathHasType(filePath, type) {
  try {
    return fs.statSync(filePath)[type]();
  } catch (error) {
    return false;
  }
}

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

function isOciLayoutFolder(rootPath) {
  return pathHasType(path.join(rootPath, 'oci-layout'), 'isFile')
    && pathHasType(path.join(rootPath, 'index.json'), 'isFile')
    && pathHasType(path.join(rootPath, 'blobs'), 'isDirectory');
}

function getReadableKind(mediaType, json) {
  if (json && Array.isArray(json.manifests)) {
    return 'image-index';
  }

  if (json && json.config && Array.isArray(json.layers)) {
    return 'image-manifest';
  }

  if (mediaType === 'application/vnd.oci.image.config.v1+json'
    || mediaType === 'application/vnd.docker.container.image.v1+json'
    || (mediaType && mediaType.includes('config'))) {
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
  if (!source || typeof source !== 'object') {
    return null;
  }

  if (source.os && source.architecture) {
    return `${source.os}/${source.architecture}${source.variant ? `/${source.variant}` : ''}`;
  }

  return source.os || source.architecture || null;
}

function getAttestationLabel(annotations) {
  return annotations && annotations['vnd.docker.reference.type'] === 'attestation-manifest'
    ? 'attestation manifest'
    : null;
}

function getPredicateTypeAnnotation(annotations) {
  if (!annotations || typeof annotations !== 'object') {
    return null;
  }

  return typeof annotations['in-toto.io/predicate-type'] === 'string'
    ? annotations['in-toto.io/predicate-type']
    : null;
}

function withPlatformLabel(baseLabel, platform) {
  return joinLabelParts([baseLabel, getPlatformLabel(platform)]);
}

function toSlug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isSlsaProvenancePredicate(predicateType) {
  try {
    const parsed = new URL(predicateType);
    return parsed.hostname === 'slsa.dev'
      && (parsed.pathname === '/provenance/v1' || parsed.pathname === '/provenance/v0.2');
  } catch (error) {
    return false;
  }
}

function getInTotoDisplayLabel(node) {
  if (node.mediaType !== 'application/vnd.in-toto+json') {
    return null;
  }

  const predicateType = node.json && typeof node.json.predicateType === 'string'
    ? node.json.predicateType.toLowerCase()
    : '';
  let baseLabel = 'attestation';

  if (isSlsaProvenancePredicate(predicateType)) {
    baseLabel = 'slsa provenance';
  } else if (predicateType.includes('spdx')) {
    baseLabel = 'sbom (spdx)';
  } else if (predicateType.includes('cyclonedx')) {
    baseLabel = 'sbom (cyclonedx)';
  } else if (predicateType) {
    const leafSegment = predicateType.split('#').pop().split('/').pop();
    baseLabel = joinLabelParts(['attestation', toSlug(leafSegment) || 'other']);
  }

  return withPlatformLabel(baseLabel, node.platform);
}

function getHumanReadableName(node) {
  const inTotoLabel = getInTotoDisplayLabel(node);
  if (inTotoLabel) {
    return inTotoLabel;
  }

  if (node.kind === 'image-manifest') {
    const attestationLabel = getAttestationLabel(node.annotations);
    if (attestationLabel) {
      const predicateType = getPredicateTypeAnnotation(node.annotations);
      const baseLabel = predicateType
        ? joinLabelParts([attestationLabel, predicateType])
        : attestationLabel;
      return withPlatformLabel(baseLabel, node.platform) || node.name;
    }

    return joinLabelParts([
      node.annotations && node.annotations['org.opencontainers.image.ref.name'],
      getPlatformLabel(node.platform)
    ]) || node.name;
  }

  if (node.kind === 'image-index') {
    const imageName = node.mediaType === 'application/vnd.oci.image.index.v1+json'
      && node.annotations
      ? node.annotations['io.containerd.image.name']
      : null;

    if (imageName) {
      return imageName;
    }

    return node.name === 'index.json' ? node.name : 'image index';
  }

  if (node.kind === 'config') {
    return withPlatformLabel('image config', node.json) || node.name;
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
    node.json.manifests.forEach((childDescriptor) => {
      childDescriptors.push({
        relation: 'manifest',
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

  if (!isOciLayoutFolder(rootPath)) {
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

  topLevelDescriptors.forEach((descriptor) => {
    const childKey = createDescriptorNode(rootPath, descriptor, 'manifest', nodesByKey, traversalStack);
    indexNode.children.push({
      relation: 'manifest',
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
  isOciLayoutFolder,
  parseLayout
};
