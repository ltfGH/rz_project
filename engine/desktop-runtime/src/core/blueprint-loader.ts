import { createHash } from 'node:crypto';

import type { RuntimeBlueprint } from '../shared/blueprint';
import { AppError } from '../shared/errors';
import type { PluginRegistry } from './plugin-registry';

const EXECUTABLE_KEYS = new Set(['script', 'sql', 'code', 'expression']);

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function rejectExecutableKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) rejectExecutableKeys(child);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (EXECUTABLE_KEYS.has(key.toLowerCase())) {
      throw new AppError('BLUEPRINT_INCOMPATIBLE', `Blueprint contains executable key '${key}'.`);
    }
    rejectExecutableKeys(child);
  }
}

function parseMinimumBlueprint(source: string): RuntimeBlueprint {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (cause) {
    throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Blueprint resource is not valid JSON.', { cause });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Blueprint resource must be an object.');
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== '1.0') {
    throw new AppError(
      'BLUEPRINT_INCOMPATIBLE',
      `Unsupported blueprint schema '${String(candidate.schemaVersion)}'.`
    );
  }
  if (!Array.isArray(candidate.plugins)) {
    throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Blueprint plugins must be an array.');
  }
  if (
    candidate.software === null ||
    typeof candidate.software !== 'object' ||
    Array.isArray(candidate.software) ||
    typeof (candidate.software as Record<string, unknown>).id !== 'string'
  ) {
    throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Blueprint software ID is required.');
  }
  return value as RuntimeBlueprint;
}

export function loadRuntimeBlueprint(
  source: string,
  expectedSha256: string,
  plugins: PluginRegistry
): RuntimeBlueprint {
  const actualSha256 = createHash('sha256').update(source, 'utf8').digest('hex');
  if (actualSha256 !== expectedSha256) {
    throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Blueprint resource digest does not match build metadata.');
  }
  const blueprint = parseMinimumBlueprint(source);
  rejectExecutableKeys(blueprint);
  plugins.assertCompatible(blueprint.plugins, blueprint.schemaVersion);
  return deepFreeze(structuredClone(blueprint));
}
