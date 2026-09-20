import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { AppError } from '../shared/errors';

export interface ProjectLock {
  readonly lockVersion: '1.0';
  readonly generatorVersion: string;
  readonly blueprintSchemaVersion: '1.0';
  readonly domainLockSha256: string;
  readonly packs: readonly Readonly<{ id: string; version: string }>[];
  readonly databaseSchemaVersion: number;
  readonly runtime: Readonly<{ desktop: string; electron: string; node: string; sqlite: string }>;
  readonly projectConfigSha256: string;
  readonly buildTarget: 'win-nsis-x64';
}

export interface ProjectLockInput {
  readonly generatorVersion: string;
  readonly blueprintSchemaVersion: '1.0';
  readonly domainLock: Readonly<{
    dependencyOrder: readonly string[];
    packs: readonly Readonly<{ id: string; version: string }>[];
  }>;
  readonly databaseSchemaVersion: number;
  readonly desktopRuntimeVersion: string;
  readonly electronVersion: string;
  readonly nodeVersion: string;
  readonly sqliteVersion: string;
  readonly projectConfig: Readonly<Record<string, unknown>>;
  readonly buildTarget: 'win-nsis-x64';
}

export interface ProjectUpgradeReport {
  readonly addedPacks: readonly Readonly<{ id: string; version: string }>[];
  readonly removedPacks: readonly Readonly<{ id: string; version: string }>[];
  readonly changedPacks: readonly Readonly<{ id: string; from: string; to: string }>[];
  readonly schemaChanged: boolean;
  readonly runtimeChanged: boolean;
  readonly requiredChecks: readonly string[];
  readonly allowed: false;
}

const RESOURCE_NAMES = Object.freeze([
  'blueprint.json', 'seed.json', 'domain-lock.json', 'project.lock.json',
  'production-runtime-catalog.cjs'
] as const);

type ResourceName = typeof RESOURCE_NAMES[number];

function canonical(value: unknown, ancestors = new Set<object>()): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new AppError('VALIDATION_FAILED', 'Canonical JSON numbers must be finite.');
    return JSON.stringify(value);
  }
  if (!value || typeof value !== 'object') throw new AppError('VALIDATION_FAILED', 'Value is not canonical JSON.');
  if (ancestors.has(value)) throw new AppError('VALIDATION_FAILED', 'Canonical JSON must be acyclic.');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((item) => canonical(item, ancestors)).join(',')}]`;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new AppError('VALIDATION_FAILED', 'Canonical JSON objects must be plain.');
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], ancestors)}`
    )).join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function frozenPack(pack: Readonly<{ id: string; version: string }>) {
  return Object.freeze({ id: pack.id, version: pack.version });
}

export function createProjectLock(input: ProjectLockInput): ProjectLock {
  return Object.freeze({
    lockVersion: '1.0',
    generatorVersion: input.generatorVersion,
    blueprintSchemaVersion: input.blueprintSchemaVersion,
    domainLockSha256: sha256(canonical(input.domainLock)),
    packs: Object.freeze(input.domainLock.packs.map(frozenPack)),
    databaseSchemaVersion: input.databaseSchemaVersion,
    runtime: Object.freeze({
      desktop: input.desktopRuntimeVersion,
      electron: input.electronVersion,
      node: input.nodeVersion,
      sqlite: input.sqliteVersion
    }),
    projectConfigSha256: sha256(canonical(input.projectConfig)),
    buildTarget: input.buildTarget
  });
}

export function canonicalProjectLock(lock: ProjectLock): string {
  return canonical(lock);
}

export function compareProjectLocks(previous: ProjectLock, next: ProjectLock): ProjectUpgradeReport {
  const before = new Map(previous.packs.map((pack) => [pack.id, pack.version]));
  const after = new Map(next.packs.map((pack) => [pack.id, pack.version]));
  const addedPacks = [...after].filter(([id]) => !before.has(id)).map(([id, version]) => Object.freeze({ id, version }));
  const removedPacks = [...before].filter(([id]) => !after.has(id)).map(([id, version]) => Object.freeze({ id, version }));
  const changedPacks = [...after].filter(([id, version]) => before.has(id) && before.get(id) !== version)
    .map(([id, to]) => Object.freeze({ id, from: before.get(id)!, to }));
  const schemaChanged = previous.databaseSchemaVersion !== next.databaseSchemaVersion;
  const runtimeChanged = canonical(previous.runtime) !== canonical(next.runtime);
  const checks = new Set<string>();
  if (schemaChanged || addedPacks.length || removedPacks.length || changedPacks.length) checks.add('migration');
  for (const pack of [...addedPacks, ...removedPacks, ...changedPacks]) checks.add(pack.id);
  if (addedPacks.length || removedPacks.length || changedPacks.length) checks.add('combinations');
  if (runtimeChanged) checks.add('desktop-runtime');
  const order = ['migration', ...[...checks].filter((item) => !['migration', 'combinations', 'desktop-runtime'].includes(item)).sort(), 'combinations', 'desktop-runtime'];
  return Object.freeze({
    addedPacks: Object.freeze(addedPacks), removedPacks: Object.freeze(removedPacks),
    changedPacks: Object.freeze(changedPacks), schemaChanged, runtimeChanged,
    requiredChecks: Object.freeze(order.filter((item) => checks.has(item))), allowed: false
  });
}

function readRegular(root: string, name: string): Buffer {
  const target = path.join(root, name);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch {
    throw new AppError('BLUEPRINT_INCOMPATIBLE', `Required resource '${name}' is missing.`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new AppError('BLUEPRINT_INCOMPATIBLE', `Resource '${name}' must be a regular file.`);
  return fs.readFileSync(target);
}

function parseJson<T>(bytes: Buffer, name: string): T {
  try { return JSON.parse(bytes.toString('utf8')) as T; }
  catch { throw new AppError('BLUEPRINT_INCOMPATIBLE', `Resource '${name}' is not valid JSON.`); }
}

export interface VerifiedProjectResources {
  readonly blueprintText: string;
  readonly seedText: string;
  readonly blueprintSha256: string;
  readonly domainLock: Readonly<{ dependencyOrder: readonly string[]; packs: readonly Readonly<{ id: string; version: string }>[] }>;
  readonly projectLock: ProjectLock;
  readonly productionCatalogPath: string;
}

export function verifyProjectResources(resourceRoot: string): VerifiedProjectResources {
  const root = path.resolve(resourceRoot);
  const manifestBytes = readRegular(root, 'resource-manifest.json');
  const manifest = parseJson<{ manifestVersion: string; files: Record<string, string> }>(manifestBytes, 'resource-manifest.json');
  if (manifest.manifestVersion !== '1.0' || !manifest.files || typeof manifest.files !== 'object') {
    throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Resource manifest is invalid.');
  }
  const bytes = {} as Record<ResourceName, Buffer>;
  for (const name of RESOURCE_NAMES) {
    const content = readRegular(root, name);
    const expected = manifest.files[name];
    if (!/^[a-f0-9]{64}$/.test(expected ?? '') || sha256(content) !== expected) {
      throw new AppError('BLUEPRINT_INCOMPATIBLE', `Resource '${name}' digest does not match its manifest.`);
    }
    bytes[name] = content;
  }
  const domainLock = parseJson<VerifiedProjectResources['domainLock']>(bytes['domain-lock.json'], 'domain-lock.json');
  const projectLock = parseJson<ProjectLock>(bytes['project.lock.json'], 'project.lock.json');
  if (projectLock.lockVersion !== '1.0' || projectLock.domainLockSha256 !== sha256(canonical(domainLock))) {
    throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Project lock domain lock digest does not match.');
  }
  const orderedPacks = domainLock.dependencyOrder.map((id) => domainLock.packs.find((pack) => pack.id === id));
  if (orderedPacks.some((pack) => !pack) || canonical(orderedPacks) !== canonical(projectLock.packs)) {
    throw new AppError('BLUEPRINT_INCOMPATIBLE', 'Project lock packs do not match domain lock order and versions.');
  }
  return Object.freeze({
    blueprintText: bytes['blueprint.json'].toString('utf8'),
    seedText: bytes['seed.json'].toString('utf8'),
    blueprintSha256: manifest.files['blueprint.json']!, domainLock, projectLock,
    productionCatalogPath: path.join(root, 'production-runtime-catalog.cjs')
  });
}
