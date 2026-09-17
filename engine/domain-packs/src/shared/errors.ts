export type CompositionIssueCode =
  | 'PACK_CATALOG_INVALID'
  | 'PACK_NOT_FOUND'
  | 'PACK_VERSION_INCOMPATIBLE'
  | 'CAPABILITY_MISSING'
  | 'CAPABILITY_AMBIGUOUS'
  | 'DEPENDENCY_NOT_ALLOWED'
  | 'DEPENDENCY_CYCLE'
  | 'OWNERSHIP_CONFLICT'
  | 'EXTENSION_POINT_UNKNOWN'
  | 'MERGE_CONFLICT'
  | 'UI_SLOT_CONFLICT'
  | 'SEED_CONFLICT'
  | 'COMPOSED_BLUEPRINT_INVALID';

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface CompositionIssue {
  readonly code: CompositionIssueCode;
  readonly packId: string;
  readonly path: string;
  readonly message: string;
  readonly severity: IssueSeverity;
}

export function issue(
  code: CompositionIssueCode,
  packId: string,
  path: string,
  message: string,
  severity: IssueSeverity = 'error'
): CompositionIssue {
  return Object.freeze({ code, packId, path, message, severity });
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortIssues(issues: readonly CompositionIssue[]): readonly CompositionIssue[] {
  return Object.freeze([...issues].sort((left, right) => (
    compare(left.packId, right.packId) ||
    compare(left.path, right.path) ||
    compare(left.code, right.code) ||
    compare(left.message, right.message)
  )));
}

export function summarizeIssues(
  issues: readonly CompositionIssue[],
  maxLength = 12_000
): string {
  if (!Number.isInteger(maxLength) || maxLength < 0) throw new Error('Summary length must be non-negative.');
  return sortIssues(issues)
    .map((entry) => `[${entry.code}] ${entry.packId} ${entry.path}: ${entry.message}`)
    .join('\n')
    .slice(0, maxLength);
}
