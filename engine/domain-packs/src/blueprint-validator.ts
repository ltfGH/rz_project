import fs from 'node:fs';
import path from 'node:path';

export interface BlueprintValidationIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly severity: string;
}

export interface BlueprintValidationResult {
  readonly valid: boolean;
  readonly canGenerate: boolean;
  readonly schemaVersion: string | null;
  readonly issues: readonly BlueprintValidationIssue[];
  readonly summary: string;
}

function validatorPath(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'blueprint', 'validate.cjs'),
    path.resolve(__dirname, '..', '..', '..', 'blueprint', 'validate.cjs')
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Existing blueprint validator was not found.');
  return found;
}

export function validateComposedBlueprint(value: unknown): BlueprintValidationResult {
  const loaded = require(validatorPath()) as { validateBlueprint?: (input: unknown) => unknown };
  if (typeof loaded.validateBlueprint !== 'function') {
    throw new Error('Existing blueprint validator has an invalid export.');
  }
  const result = loaded.validateBlueprint(value);
  if (!result || typeof result !== 'object') throw new Error('Blueprint validator returned an invalid result.');
  const candidate = result as Record<string, unknown>;
  if (
    typeof candidate.valid !== 'boolean' ||
    typeof candidate.canGenerate !== 'boolean' ||
    !Array.isArray(candidate.issues) ||
    typeof candidate.summary !== 'string'
  ) {
    throw new Error('Blueprint validator returned an invalid result shape.');
  }
  return result as BlueprintValidationResult;
}
