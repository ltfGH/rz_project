import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { loadPack } from './catalog/load-pack';
import { PackRegistry } from './catalog/registry';
import { composeDomainPacks } from './composition/compose';
import { canonicalJson } from './shared/canonical-json';

const MAX_REQUEST_BYTES = 5 * 1024 * 1024;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function regularFile(filePath: string): void {
  let stat: fs.Stats;
  try { stat = fs.lstatSync(filePath); } catch { fail('Composition request file does not exist.'); }
  if (stat!.isSymbolicLink() || !stat!.isFile()) fail('Composition request must be a regular file.');
  if (stat!.size > MAX_REQUEST_BYTES) fail('Composition request must not exceed 5 MiB.');
}

function parseEnvelope(requestPath: string): { packs: string[]; composition: unknown } {
  let value: unknown;
  try { value = JSON.parse(fs.readFileSync(requestPath, 'utf8')); }
  catch { fail('Composition request must contain valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Composition request envelope must be an object.');
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some((key) => key !== 'packs' && key !== 'composition')) {
    fail('Composition request envelope contains unknown properties.');
  }
  if (!Array.isArray(object.packs) || object.packs.length === 0 || object.packs.length > 32 ||
      object.packs.some((item) => typeof item !== 'string' || !path.isAbsolute(item))) {
    fail('Composition request packs must be absolute paths.');
  }
  if (new Set(object.packs).size !== object.packs.length) fail('Composition request packs must be unique.');
  return { packs: object.packs as string[], composition: object.composition };
}

function assertOutput(outputPath: string): boolean {
  if (!fs.existsSync(outputPath)) return false;
  const stat = fs.lstatSync(outputPath);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail('Composition output must be a regular directory.');
  if (fs.readdirSync(outputPath).length > 0) fail('Composition output directory must be empty.');
  return true;
}

function publish(
  outputPath: string,
  existedEmpty: boolean,
  blueprint: unknown,
  lock: unknown,
  report: unknown
): void {
  const parent = path.dirname(outputPath);
  fs.mkdirSync(parent, { recursive: true });
  const staging = path.join(parent, `.${path.basename(outputPath)}.staging-${randomUUID()}`);
  try {
    fs.mkdirSync(staging);
    fs.writeFileSync(path.join(staging, 'blueprint.json'), canonicalJson(blueprint), 'utf8');
    fs.writeFileSync(path.join(staging, 'domain-lock.json'), canonicalJson(lock), 'utf8');
    fs.writeFileSync(path.join(staging, 'composition-report.json'), canonicalJson(report), 'utf8');
    if (existedEmpty) fs.rmdirSync(outputPath);
    fs.renameSync(staging, outputPath);
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function main(args: string[]): void {
  if (args.length !== 4 || args[0] !== '--request' || args[2] !== '--output') {
    fail('Usage: cli --request <absolute-json> --output <absolute-directory>');
  }
  const requestPath = args[1]!;
  const outputPath = args[3]!;
  if (!path.isAbsolute(requestPath) || !path.isAbsolute(outputPath)) fail('Request and output paths must be absolute.');
  regularFile(requestPath);
  const existedEmpty = assertOutput(outputPath);
  const envelope = parseEnvelope(requestPath);
  const registry = new PackRegistry();
  try {
    envelope.packs.map(loadPack).forEach((pack) => registry.register(pack));
  } catch {
    fail('One or more domain packs could not be loaded.');
  }
  const result = composeDomainPacks(envelope.composition, registry);
  const response = {
    valid: result.valid,
    canGenerate: result.canGenerate,
    issues: result.issues,
    summary: result.summary,
    outputPath: result.canGenerate ? outputPath : null
  };
  if (!result.canGenerate || !result.blueprint || !result.lock) {
    process.stdout.write(canonicalJson(response));
    process.exitCode = 1;
    return;
  }
  try {
    publish(outputPath, existedEmpty, result.blueprint, result.lock, {
      ...result.report,
      valid: result.valid,
      canGenerate: result.canGenerate,
      issues: result.issues
    });
  } catch {
    fail('Composition outputs could not be published atomically.');
  }
  process.stdout.write(canonicalJson(response));
}

main(process.argv.slice(2));
