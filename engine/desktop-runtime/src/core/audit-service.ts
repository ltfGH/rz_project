import type { DatabaseSync } from 'node:sqlite';

import type { ActorDto } from '../shared/dto';

interface AuditEvent {
  readonly actor: ActorDto;
  readonly permission: string;
  readonly entityId?: string;
  readonly recordId?: number;
  readonly result: 'success' | 'failure';
  readonly details: Readonly<Record<string, unknown>>;
}

const SENSITIVE = /password|token|digest|sql|path|stack|cause/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (!SENSITIVE.test(key)) result[key] = redact(child);
  }
  return result;
}

export class AuditService {
  readonly #appVersion: string;
  readonly #now: () => Date;

  constructor(appVersion: string, now: () => Date = () => new Date()) {
    this.#appVersion = appVersion;
    this.#now = now;
  }

  append(connection: DatabaseSync, event: AuditEvent): void {
    connection.prepare([
      'INSERT INTO sys_audit_event',
      '(actor_id, actor_name, permission, entity_id, record_id, result, detail_json, app_version, created_at)',
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ].join(' ')).run(
      event.actor.userId,
      event.actor.displayName,
      event.permission,
      event.entityId ?? null,
      event.recordId ?? null,
      event.result,
      JSON.stringify(redact(event.details)),
      this.#appVersion,
      this.#now().toISOString()
    );
  }
}
