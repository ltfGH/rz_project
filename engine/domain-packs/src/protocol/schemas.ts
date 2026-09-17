import path from 'node:path';
import { z } from 'zod';

import type {
  CompositionRequest,
  JsonValue,
  PackCatalog,
  PackFragment
} from '../shared/types';

const id = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);
const dottedId = z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/);
const version = z.string().regex(/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/);
const blueprintVersion = z.string().regex(/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/);
const nonBlank = z.string().trim().min(1).max(500);
const uniqueStrings = <T extends z.ZodTypeAny>(item: T) => z.array(item).refine(
  (values) => new Set(values).size === values.length,
  { message: 'Array values must be unique.' }
);

const jsonValue: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(), z.boolean(), z.number().finite(), z.string(),
  z.array(jsonValue), z.record(z.string(), jsonValue)
]));

const entryPath = z.string().refine((value) => {
  if (!value || value.includes('\\') || value.startsWith('/') || path.win32.isAbsolute(value)) return false;
  const parts = value.split('/');
  return parts.every((part) => part !== '' && part !== '.' && part !== '..');
}, { message: 'Entrypoint must be a normalized safe relative path.' });

const uiSlot = z.enum([
  'entity.detail.tabs',
  'entity.detail.actions',
  'dashboard.sections',
  'form.field.renderers',
  'report.sections'
]);

export const packCatalogSchema = z.object({
  catalogVersion: z.literal('1.0'),
  id,
  version,
  name: nonBlank,
  description: nonBlank,
  blueprintSchemaVersions: uniqueStrings(blueprintVersion),
  runtimeVersions: uniqueStrings(version),
  provides: uniqueStrings(dottedId),
  requires: uniqueStrings(dottedId),
  allowedDependencies: uniqueStrings(id),
  migrationsVersion: z.number().int().nonnegative(),
  entrypoints: z.object({
    fragment: entryPath,
    runtime: entryPath,
    ui: entryPath,
    seed: entryPath,
    tests: entryPath
  }).strict(),
  uiSlots: uniqueStrings(uiSlot)
}).strict();

const ownedObject = z.object({ id }).passthrough();
const ownedKind = z.enum(['entity', 'module', 'workflow', 'role']);
const mergeOperation = z.enum(['append', 'merge_display', 'extend_enum', 'add_transition']);

export const packFragmentSchema = z.object({
  fragmentVersion: z.literal('1.0'),
  pack: z.object({ id, version }).strict(),
  owns: z.object({
    entities: uniqueStrings(id),
    modules: uniqueStrings(id),
    workflows: uniqueStrings(id),
    roles: uniqueStrings(id)
  }).strict(),
  publicExtensionPoints: z.array(z.object({
    id: dottedId,
    targetKind: ownedKind,
    targetId: id,
    allowedOperations: uniqueStrings(mergeOperation).min(1)
  }).strict()),
  extensions: z.array(z.object({
    point: dottedId,
    operation: mergeOperation,
    path: z.union([
      z.literal('/'),
      z.string().regex(/^\/(?:[^/~]|~[01])+(?:\/(?:[^/~]|~[01])*)*$/)
    ]),
    value: jsonValue
  }).strict()),
  blueprint: z.object({
    entities: z.array(ownedObject),
    modules: z.array(ownedObject),
    workflows: z.array(ownedObject),
    roles: z.array(ownedObject),
    dashboards: z.array(ownedObject)
  }).strict(),
  seed: z.object({
    records: z.record(id, z.array(z.record(id, jsonValue)))
  }).strict()
}).strict().superRefine((fragment, context) => {
  const sections = [
    ['entities', fragment.blueprint.entities, fragment.owns.entities],
    ['modules', fragment.blueprint.modules, fragment.owns.modules],
    ['workflows', fragment.blueprint.workflows, fragment.owns.workflows],
    ['roles', fragment.blueprint.roles, fragment.owns.roles]
  ] as const;
  for (const [name, objects, owned] of sections) {
    const objectIds = objects.map((item) => item.id).sort();
    const ownedIds = [...owned].sort();
    if (JSON.stringify(objectIds) !== JSON.stringify(ownedIds)) {
      context.addIssue({
        code: 'custom',
        path: ['owns', name],
        message: `Every ${name} object must be owned exactly once by its defining pack.`
      });
    }
  }
  const ownedByKind = {
    entity: new Set(fragment.owns.entities),
    module: new Set(fragment.owns.modules),
    workflow: new Set(fragment.owns.workflows),
    role: new Set(fragment.owns.roles)
  };
  fragment.publicExtensionPoints.forEach((point, index) => {
    if (!ownedByKind[point.targetKind].has(point.targetId)) {
      context.addIssue({
        code: 'custom',
        path: ['publicExtensionPoints', index, 'targetId'],
        message: 'Extension point target must be owned by this pack.'
      });
    }
  });
});

export const compositionRequestSchema = z.object({
  blueprintSchemaVersion: z.literal('1.0'),
  runtimeVersion: version,
  software: z.record(z.string(), jsonValue),
  selections: z.array(z.object({
    id,
    version,
    config: z.record(z.string(), jsonValue)
  }).strict()).min(1),
  coverage: z.object({
    supported: uniqueStrings(nonBlank).min(1),
    unsupported: uniqueStrings(nonBlank)
  }).strict(),
  materials: z.record(z.string(), jsonValue)
}).strict();

const EXECUTABLE_KEYS = new Set(['script', 'sql', 'expression', 'command', 'executable']);

function rejectExecutableKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(rejectExecutableKeys);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (EXECUTABLE_KEYS.has(key.toLowerCase())) {
      throw new Error(`Fragment contains executable key '${key}'.`);
    }
    rejectExecutableKeys(child);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export function parseCatalog(value: unknown): PackCatalog {
  try {
    return deepFreeze(packCatalogSchema.parse(value)) as PackCatalog;
  } catch (error) {
    throw new Error(`Invalid pack catalog: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseFragment(value: unknown): PackFragment {
  try {
    const parsed = packFragmentSchema.parse(value);
    rejectExecutableKeys(parsed);
    return deepFreeze(parsed) as PackFragment;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('executable key')) throw error;
    throw new Error(`Invalid pack fragment: ${message}`);
  }
}

export function parseCompositionRequest(value: unknown): CompositionRequest {
  try {
    const parsed = compositionRequestSchema.parse(value);
    rejectExecutableKeys(parsed);
    return deepFreeze(parsed) as CompositionRequest;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('executable key')) throw error;
    throw new Error(`Invalid composition request: ${message}`);
  }
}
