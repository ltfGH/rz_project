import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { parseCatalog, parseFragment } from '../protocol/schemas';
import { canonicalJson } from '../shared/canonical-json';
import type { LoadedPack } from '../shared/types';

const MAX_JSON_BYTES = 5 * 1024 * 1024;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function assertRegularNoReparse(target: string, description: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch {
    throw new Error(`${description} does not exist: ${target}`);
  }
  if (stat.isSymbolicLink()) throw new Error(`${description} cannot be a symbolic link or reparse point: ${target}`);
  if (!stat.isFile()) throw new Error(`${description} must be a regular file: ${target}`);
}

function assertDirectoryNoReparse(target: string, description: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch {
    throw new Error(`${description} does not exist: ${target}`);
  }
  if (stat.isSymbolicLink()) throw new Error(`${description} cannot be a symbolic link or reparse point: ${target}`);
  if (!stat.isDirectory()) throw new Error(`${description} must be a directory: ${target}`);
}

function resolveEntry(root: string, relative: string, description: string): string {
  const target = path.resolve(root, ...relative.split('/'));
  const prefix = `${root}${path.sep}`;
  if (!target.startsWith(prefix)) throw new Error(`${description} escapes the pack root.`);
  let current = root;
  const parts = relative.split('/');
  parts.forEach((part, index) => {
    current = path.join(current, part);
    if (index < parts.length - 1) assertDirectoryNoReparse(current, description);
    else assertRegularNoReparse(current, description);
  });
  return target;
}

function readJson(filePath: string, description: string): unknown {
  assertRegularNoReparse(filePath, description);
  const size = fs.statSync(filePath).size;
  if (size > MAX_JSON_BYTES) throw new Error(`${description} exceeds 5 MiB.`);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${description} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function loadPack(packRoot: string): LoadedPack {
  if (!path.isAbsolute(packRoot)) throw new Error('Pack root must be an absolute path.');
  const root = path.resolve(packRoot);
  assertDirectoryNoReparse(root, 'Pack root');
  const catalogPath = path.join(root, 'catalog.json');
  const catalog = parseCatalog(readJson(catalogPath, 'catalog.json'));
  const fragmentPath = resolveEntry(root, catalog.entrypoints.fragment, 'Blueprint entrypoint');
  const fragment = parseFragment(readJson(fragmentPath, 'blueprint.json'));
  for (const [name, relative] of Object.entries(catalog.entrypoints)) {
    resolveEntry(root, relative, `${name} entrypoint`);
  }
  if (fragment.pack.id !== catalog.id || fragment.pack.version !== catalog.version) {
    throw new Error(
      `Fragment identity '${fragment.pack.id}@${fragment.pack.version}' does not match catalog '${catalog.id}@${catalog.version}'.`
    );
  }
  const catalogCanonical = canonicalJson(catalog);
  const fragmentCanonical = canonicalJson(fragment);
  return Object.freeze({
    root,
    catalog,
    fragment,
    digest: sha256(`${catalogCanonical}${fragmentCanonical}`),
    fragmentDigest: sha256(fragmentCanonical)
  });
}
