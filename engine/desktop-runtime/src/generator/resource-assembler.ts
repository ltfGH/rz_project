import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { compileSchema } from '../core/schema-compiler';
import { canonicalProjectLock, createProjectLock } from '../core/project-lock';
import { createStandardProject, loadStandardTemplateCatalog, type StandardProjectRequest } from './standard-project';
import { generateStandardSeed } from './standard-seed';

function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (!value || typeof value !== 'object') throw new Error('Standard resource value is not canonical JSON.');
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function sha256(value: Buffer | string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function roots() {
  const desktopRoot = path.resolve(__dirname, '..', '..');
  const engineRoot = path.resolve(desktopRoot, '..');
  return { desktopRoot, domainRoot: path.join(engineRoot, 'domain-packs') };
}

export function assembleStandardResources(rawRequest: StandardProjectRequest, outputDirectory: string): void {
  const output = path.resolve(outputDirectory);
  if (fs.existsSync(output)) throw new Error('Standard resource output already exists and must be empty.');
  const { desktopRoot, domainRoot } = roots();
  const catalog = loadStandardTemplateCatalog();
  const descriptor = catalog.templates.find((entry) => entry.id === rawRequest.templateId);
  if (!descriptor) throw new Error(`Standard template '${rawRequest.templateId}' is not supported.`);

  const { PackRegistry } = require(path.join(domainRoot, 'src', 'catalog', 'registry.ts')) as any;
  const { loadPack } = require(path.join(domainRoot, 'src', 'catalog', 'load-pack.ts')) as any;
  const { composeDomainPacks } = require(path.join(domainRoot, 'src', 'composition', 'compose.ts')) as any;
  const registry = new PackRegistry();
  for (const pack of descriptor.packs) registry.register(loadPack(path.join(domainRoot, 'packs', pack.id)));
  const composition = composeDomainPacks({
    blueprintSchemaVersion: '1.0', runtimeVersion: '1.0.0', software: rawRequest.software,
    selections: descriptor.packs,
    coverage: { supported: descriptor.coverage, unsupported: [] },
    materials: descriptor.materials
  }, registry);
  if (!composition.canGenerate || !composition.blueprint || !composition.lock) {
    throw new Error(composition.summary || 'Standard domain composition failed.');
  }

  const built = createStandardProject(rawRequest, catalog, composition.blueprint);
  const seed = generateStandardSeed(built.project, built.blueprint, rawRequest.passwordDigests);
  const blueprintText = canonical(built.blueprint);
  const seedText = canonical(seed);
  const domainText = canonical(composition.lock);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'standard-resource-'));
  const catalogPath = path.join(temporary, 'production-runtime-catalog.cjs');
  try {
    const catalogBuild = spawnSync(process.execPath, [
      path.join(domainRoot, 'tools', 'build-runtime-catalog.cjs'), '--outfile', catalogPath
    ], { cwd: domainRoot, encoding: 'utf8', windowsHide: true });
    if (catalogBuild.status !== 0) throw new Error(catalogBuild.stderr || catalogBuild.stdout || 'Production catalog build failed.');
    const packageJson = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
    const electronPackage = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'node_modules', 'electron', 'package.json'), 'utf8'));
    const projectConfig = JSON.parse(JSON.stringify(built.project)) as Record<string, unknown>;
    const lock = createProjectLock({
      generatorVersion: '1.0.0', blueprintSchemaVersion: '1.0', domainLock: composition.lock,
      databaseSchemaVersion: compileSchema(built.blueprint).version,
      desktopRuntimeVersion: packageJson.version, electronVersion: electronPackage.version,
      nodeVersion: process.versions.node, sqliteVersion: process.versions.sqlite ?? 'unknown',
      projectConfig, buildTarget: 'win-nsis-x64'
    });
    const resources: Record<string, Buffer> = {
      'blueprint.json': Buffer.from(blueprintText),
      'seed.json': Buffer.from(seedText),
      'domain-lock.json': Buffer.from(domainText),
      'project.lock.json': Buffer.from(canonicalProjectLock(lock)),
      'production-runtime-catalog.cjs': fs.readFileSync(catalogPath)
    };
    const manifest = Buffer.from(JSON.stringify({
      manifestVersion: '1.0',
      files: Object.fromEntries(Object.entries(resources).map(([name, bytes]) => [name, sha256(bytes)]))
    }, null, 2));
    const parent = path.dirname(output);
    fs.mkdirSync(parent, { recursive: true });
    const staging = path.join(parent, `.${path.basename(output)}.staging-${crypto.randomUUID()}`);
    fs.mkdirSync(staging);
    try {
      for (const [name, bytes] of Object.entries(resources)) fs.writeFileSync(path.join(staging, name), bytes);
      fs.writeFileSync(path.join(staging, 'resource-manifest.json'), manifest);
      fs.renameSync(staging, output);
    } catch (error) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw error;
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
