import type { RuntimeDatabase } from './database';

interface SeedUser {
  readonly username: string;
  readonly displayName: string;
  readonly roleId: string;
  readonly passwordDigest: string;
}

interface SeedAsset {
  readonly code: string;
  readonly name: string;
  readonly status: string;
}

interface RuntimeSeed {
  readonly users: readonly SeedUser[];
  readonly assets: readonly SeedAsset[];
  readonly taskCount: number;
}

export function seedAcceptanceData(database: RuntimeDatabase, seed: RuntimeSeed): void {
  const exists = database.prepare('SELECT value FROM sys_metadata WHERE key = ?').get('acceptance_seed');
  if (exists) return;
  const now = new Date().toISOString();
  database.transaction((connection) => {
    const insertUser = connection.prepare([
      'INSERT INTO sys_user',
      '(username, display_name, role_id, password_digest, enabled, created_at, updated_at)',
      'VALUES (?, ?, ?, ?, 1, ?, ?)'
    ].join(' '));
    for (const user of seed.users) {
      insertUser.run(
        user.username, user.displayName, user.roleId, user.passwordDigest, now, now
      );
    }
    const insertAsset = connection.prepare([
      'INSERT INTO biz_asset (code, name, status, created_at, updated_at)',
      'VALUES (?, ?, ?, ?, ?)'
    ].join(' '));
    for (const asset of seed.assets) {
      insertAsset.run(asset.code, asset.name, asset.status, now, now);
    }
    const insertTask = connection.prepare([
      'INSERT INTO biz_task (code, title, asset_code, status, priority, created_at, updated_at)',
      'VALUES (?, ?, ?, ?, ?, ?, ?)'
    ].join(' '));
    for (let index = 1; index <= seed.taskCount; index += 1) {
      const number = String(index).padStart(3, '0');
      const asset = seed.assets[(index - 1) % seed.assets.length];
      if (!asset) throw new Error('Acceptance seed requires at least one asset.');
      insertTask.run(
        `TASK-${number}`,
        index === 1 ? '处理核心节点异常' : `处理例行任务 ${number}`,
        asset.code,
        'pending',
        index % 5 === 0 ? 'high' : 'normal',
        now,
        now
      );
    }
    connection.prepare(
      'INSERT INTO sys_metadata (key, value, updated_at) VALUES (?, ?, ?)'
    ).run('acceptance_seed', '1', now);
  });
}

interface ProjectSeed {
  readonly formatVersion: '1.0';
  readonly seedId: string;
  readonly baseline: string;
  readonly users: readonly SeedUser[];
  readonly recordOrder: readonly string[];
  readonly records: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
}

const SAFE_IDENTIFIER = /^[a-z][a-z0-9_]{1,63}$/;

function boundValue(value: unknown): string | number | null {
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  throw new Error('Project seed values must be JSON scalars.');
}

export function seedProjectData(database: RuntimeDatabase, seed: ProjectSeed): void {
  if (seed.formatVersion !== '1.0' || !seed.seedId.trim()) throw new Error('Project seed metadata is invalid.');
  const baseline = new Date(seed.baseline);
  if (!Number.isFinite(baseline.getTime()) || baseline.toISOString() !== seed.baseline) {
    throw new Error('Project seed baseline is invalid.');
  }
  if (new Set(seed.recordOrder).size !== seed.recordOrder.length) {
    throw new Error('Project seed record order contains duplicates.');
  }
  const metadataKey = `project_seed:${seed.seedId}`;
  if (database.prepare('SELECT value FROM sys_metadata WHERE key = ?').get(metadataKey)) return;

  database.transaction((connection) => {
    const insertUser = connection.prepare([
      'INSERT INTO sys_user',
      '(username, display_name, role_id, password_digest, enabled, created_at, updated_at)',
      'VALUES (?, ?, ?, ?, 1, ?, ?)'
    ].join(' '));
    for (const user of seed.users) {
      insertUser.run(
        user.username, user.displayName, user.roleId, user.passwordDigest,
        seed.baseline, seed.baseline
      );
    }

    for (const entityId of seed.recordOrder) {
      if (!SAFE_IDENTIFIER.test(entityId)) throw new Error('Project seed entity identifier is invalid.');
      const records = seed.records[entityId];
      if (!records) throw new Error(`Project seed records are missing for '${entityId}'.`);
      for (const record of records) {
        const keys = Object.keys(record);
        if (keys.length === 0 || keys.some((key) => !SAFE_IDENTIFIER.test(key))) {
          throw new Error(`Project seed fields are invalid for '${entityId}'.`);
        }
        const columns = [...keys, 'version', 'created_at', 'updated_at'];
        const placeholders = columns.map(() => '?').join(',');
        const values = keys.map((key) => boundValue(record[key]));
        connection.prepare(
          `INSERT INTO biz_${entityId} (${columns.join(',')}) VALUES (${placeholders})`
        ).run(...values, 1, seed.baseline, seed.baseline);
      }
    }
    connection.prepare(
      'INSERT INTO sys_metadata (key, value, updated_at) VALUES (?, ?, ?)'
    ).run(metadataKey, '1', seed.baseline);
  });
}
