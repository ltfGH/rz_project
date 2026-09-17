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
