export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type MergeOperation = 'append' | 'merge_display' | 'extend_enum' | 'add_transition';
export type OwnedKind = 'entity' | 'module' | 'workflow' | 'role';

export interface PackEntrypoints {
  readonly fragment: string;
  readonly runtime: string;
  readonly ui: string;
  readonly seed: string;
  readonly tests: string;
}

export interface PackCatalog {
  readonly catalogVersion: '1.0';
  readonly id: string;
  readonly version: string;
  readonly name: string;
  readonly description: string;
  readonly blueprintSchemaVersions: readonly string[];
  readonly runtimeVersions: readonly string[];
  readonly provides: readonly string[];
  readonly requires: readonly string[];
  readonly allowedDependencies: readonly string[];
  readonly migrationsVersion: number;
  readonly entrypoints: PackEntrypoints;
  readonly uiSlots: readonly string[];
}

export interface OwnedObjects {
  readonly entities: readonly string[];
  readonly modules: readonly string[];
  readonly workflows: readonly string[];
  readonly roles: readonly string[];
}

export interface PublicExtensionPoint {
  readonly id: string;
  readonly targetKind: OwnedKind;
  readonly targetId: string;
  readonly allowedOperations: readonly MergeOperation[];
}

export interface FragmentExtension {
  readonly point: string;
  readonly operation: MergeOperation;
  readonly path: string;
  readonly value: JsonValue;
}

export interface PackFragment {
  readonly fragmentVersion: '1.0';
  readonly pack: Readonly<{ id: string; version: string }>;
  readonly owns: OwnedObjects;
  readonly publicExtensionPoints: readonly PublicExtensionPoint[];
  readonly extensions: readonly FragmentExtension[];
  readonly blueprint: Readonly<Record<string, JsonValue>>;
  readonly seed: Readonly<{
    records: Readonly<Record<string, readonly Readonly<Record<string, JsonValue>>[]>>;
  }>;
}

export interface LoadedPack {
  readonly root: string;
  readonly catalog: PackCatalog;
  readonly fragment: PackFragment;
  readonly digest: string;
  readonly fragmentDigest: string;
  readonly entrypointDigests: Readonly<Record<keyof PackEntrypoints, string>>;
}

export interface PackSelection {
  readonly id: string;
  readonly version: string;
  readonly config: Readonly<Record<string, JsonValue>>;
}

export interface CompositionRequest {
  readonly blueprintSchemaVersion: '1.0';
  readonly runtimeVersion: string;
  readonly software: Readonly<Record<string, JsonValue>>;
  readonly selections: readonly PackSelection[];
  readonly coverage: Readonly<{ supported: readonly string[]; unsupported: readonly string[] }>;
  readonly materials: Readonly<Record<string, JsonValue>>;
}

export interface DomainLockPack {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
  readonly fragmentDigest: string;
  readonly migrationsVersion: number;
  readonly dependencies: readonly string[];
  readonly uiEntrypointDigest: string;
}

export interface DomainLock {
  readonly lockVersion: '1.0';
  readonly blueprintSchemaVersion: '1.0';
  readonly runtimeVersion: string;
  readonly dependencyOrder: readonly string[];
  readonly packs: readonly DomainLockPack[];
}

export interface CompositionResult {
  readonly valid: boolean;
  readonly canGenerate: boolean;
  readonly blueprint?: Readonly<Record<string, JsonValue>>;
  readonly lock?: DomainLock;
  readonly report: Readonly<Record<string, JsonValue>>;
  readonly issues: readonly import('./errors').CompositionIssue[];
  readonly summary: string;
}
