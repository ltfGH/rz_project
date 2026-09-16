'use strict';

const fs = require('node:fs');
const path = require('node:path');

const configRoot = path.resolve(__dirname, '..', 'config');

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function readCatalog(filePath, collectionName) {
  let document;
  try {
    document = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${collectionName} catalog '${filePath}': ${error.message}`);
  }
  if (document.catalogVersion !== '1.0' || !Array.isArray(document[collectionName])) {
    throw new Error(`Invalid ${collectionName} catalog '${filePath}'.`);
  }
  return document[collectionName];
}

function indexDescriptors(descriptors, kind, filePath) {
  const index = new Map();
  for (const descriptor of descriptors) {
    if (!descriptor || typeof descriptor.id !== 'string' || descriptor.id.length === 0) {
      throw new Error(`Invalid ${kind} descriptor in '${filePath}'.`);
    }
    if (index.has(descriptor.id)) {
      throw new Error(`Duplicate ${kind} ID '${descriptor.id}' in '${filePath}'.`);
    }
    index.set(descriptor.id, deepFreeze(descriptor));
  }
  return index;
}

function loadCatalog(options = {}) {
  const archetypePath = path.resolve(
    options.archetypePath || path.join(configRoot, 'archetypes.json')
  );
  const pluginPath = path.resolve(
    options.pluginPath || path.join(configRoot, 'plugins.json')
  );
  const archetypes = indexDescriptors(
    readCatalog(archetypePath, 'archetypes'),
    'archetype',
    archetypePath
  );
  const plugins = indexDescriptors(
    readCatalog(pluginPath, 'plugins'),
    'plugin',
    pluginPath
  );

  for (const archetype of archetypes.values()) {
    if (!Array.isArray(archetype.allowedPlugins)) {
      throw new Error(`Archetype '${archetype.id}' has invalid allowedPlugins in '${archetypePath}'.`);
    }
    for (const pluginId of archetype.allowedPlugins) {
      if (!plugins.has(pluginId)) {
        throw new Error(
          `Archetype '${archetype.id}' references unknown plugin '${pluginId}' in '${archetypePath}'.`
        );
      }
    }
  }

  return Object.freeze({ archetypes, plugins });
}

module.exports = { loadCatalog };
