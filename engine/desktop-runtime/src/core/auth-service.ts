import { createHash, randomBytes } from 'node:crypto';

import type { ActorDto } from '../shared/dto';
import { AppError } from '../shared/errors';
import type { RuntimeDatabase } from './database';
import { verifyPassword } from './passwords';

interface AuthOptions {
  readonly now?: () => Date;
  readonly tokenFactory?: () => string;
  readonly sessionDurationMs?: number;
  readonly maxAttempts?: number;
  readonly lockDurationMs?: number;
}

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role_id: string;
  password_digest: string;
  enabled: number;
  failed_attempts: number;
  locked_until: string | null;
}

export interface LoginSession {
  readonly token: string;
  readonly actor: ActorDto;
  readonly expiresAt: string;
}

function tokenDigest(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function denied(): AppError {
  return new AppError('UNAUTHENTICATED', '账号或密码无效。');
}

export class AuthService {
  readonly #database: RuntimeDatabase;
  readonly #now: () => Date;
  readonly #tokenFactory: () => string;
  readonly #sessionDurationMs: number;
  readonly #maxAttempts: number;
  readonly #lockDurationMs: number;

  constructor(database: RuntimeDatabase, options: AuthOptions = {}) {
    this.#database = database;
    this.#now = options.now ?? (() => new Date());
    this.#tokenFactory = options.tokenFactory ?? (() => randomBytes(32).toString('base64url'));
    this.#sessionDurationMs = options.sessionDurationMs ?? (8 * 60 * 60 * 1000);
    this.#maxAttempts = options.maxAttempts ?? 5;
    this.#lockDurationMs = options.lockDurationMs ?? (15 * 60 * 1000);
  }

  async login(username: string, password: string): Promise<LoginSession> {
    const row = this.#database.prepare(
      'SELECT * FROM sys_user WHERE username = ?'
    ).get(username) as UserRow | undefined;
    const now = this.#now();
    if (!row || row.enabled !== 1) throw denied();
    if (row.locked_until && new Date(row.locked_until).getTime() > now.getTime()) throw denied();

    if (!await verifyPassword(password, row.password_digest)) {
      const attempts = row.failed_attempts + 1;
      const lockedUntil = attempts >= this.#maxAttempts
        ? new Date(now.getTime() + this.#lockDurationMs).toISOString()
        : null;
      this.#database.prepare(
        'UPDATE sys_user SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?'
      ).run(attempts, lockedUntil, now.toISOString(), row.id);
      throw denied();
    }

    const token = this.#tokenFactory();
    const expiresAt = new Date(now.getTime() + this.#sessionDurationMs).toISOString();
    this.#database.transaction((connection) => {
      connection.prepare('DELETE FROM sys_session WHERE expires_at <= ?').run(now.toISOString());
      connection.prepare(
        'UPDATE sys_user SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?'
      ).run(now.toISOString(), row.id);
      connection.prepare(
        'INSERT INTO sys_session (user_id, token_digest, expires_at, created_at) VALUES (?, ?, ?, ?)'
      ).run(row.id, tokenDigest(token), expiresAt, now.toISOString());
    });
    return Object.freeze({ token, actor: this.#actor(row), expiresAt });
  }

  requireSession(token: string): ActorDto {
    const now = this.#now().toISOString();
    const row = this.#database.prepare([
      'SELECT u.id, u.username, u.display_name, u.role_id, u.enabled, s.id AS session_id, s.expires_at',
      'FROM sys_session s JOIN sys_user u ON u.id = s.user_id',
      'WHERE s.token_digest = ?'
    ].join(' ')).get(tokenDigest(token)) as (UserRow & { session_id: number; expires_at: string }) | undefined;
    if (!row || row.enabled !== 1 || row.expires_at <= now) {
      if (row) this.#database.prepare('DELETE FROM sys_session WHERE id = ?').run(row.session_id);
      throw denied();
    }
    return this.#actor(row);
  }

  logout(token: string): void {
    this.#database.prepare('DELETE FROM sys_session WHERE token_digest = ?').run(tokenDigest(token));
  }

  #actor(row: Pick<UserRow, 'id' | 'username' | 'display_name' | 'role_id'>): ActorDto {
    return Object.freeze({
      userId: Number(row.id),
      username: row.username,
      displayName: row.display_name,
      roleId: row.role_id
    });
  }
}
