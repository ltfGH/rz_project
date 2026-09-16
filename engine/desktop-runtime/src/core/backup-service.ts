import { createHash } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

import type { ActorDto } from '../shared/dto';
import { AppError } from '../shared/errors';
import type { AuditService } from './audit-service';
import type { RuntimeDatabase } from './database';
import type { PermissionService } from './permission-service';

export interface DatabaseController {
  current(): RuntimeDatabase;
  close(): void;
  reopen(): RuntimeDatabase;
}

interface StoredManifest {
  readonly appId: string;
  readonly appVersion: string;
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly fileName: string;
  readonly sha256: string;
  readonly size: number;
}

export interface BackupManifest extends StoredManifest {
  readonly databasePath: string;
  readonly manifestPath: string;
}

export interface BackupInspection {
  readonly valid: true;
  readonly databasePath: string;
  readonly manifestPath: string;
  readonly manifest: StoredManifest;
}

export interface RestoreResult {
  readonly restored: true;
  readonly protectionPath: string;
}

interface BackupServiceOptions {
  readonly databasePath: string;
  readonly appId: string;
  readonly appVersion: string;
  readonly schemaVersion: number;
  readonly controller: DatabaseController;
  readonly permissions: PermissionService;
  readonly audit: AuditService;
  readonly now?: () => Date;
}

function sha256(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function stamp(date: Date): string {
  return date.toISOString().replaceAll(/[-:.]/g, '');
}

function readManifest(manifestPath: string): StoredManifest {
  try {
    const value = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Partial<StoredManifest>;
    if (
      typeof value.appId !== 'string' ||
      typeof value.appVersion !== 'string' ||
      !Number.isInteger(value.schemaVersion) ||
      typeof value.createdAt !== 'string' ||
      typeof value.fileName !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.sha256 ?? '') ||
      !Number.isInteger(value.size)
    ) {
      throw new Error('invalid manifest shape');
    }
    return value as StoredManifest;
  } catch (cause) {
    throw new AppError('RESTORE_FAILED', '备份清单无效。', { cause });
  }
}

export class BackupService {
  readonly #options: BackupServiceOptions;

  constructor(options: BackupServiceOptions) {
    this.#options = options;
  }

  async createBackup(destinationDirectory: string, actor: ActorDto): Promise<BackupManifest> {
    this.#options.permissions.require(actor, 'maintenance.backup');
    const createdAt = (this.#options.now ?? (() => new Date()))();
    const baseName = `backup-${stamp(createdAt)}`;
    const databasePath = path.join(destinationDirectory, `${baseName}.sqlite`);
    const manifestPath = path.join(destinationDirectory, `${baseName}.manifest.json`);
    const temporaryDatabase = `${databasePath}.tmp`;
    const temporaryManifest = `${manifestPath}.tmp`;
    fs.mkdirSync(destinationDirectory, { recursive: true });
    if (fs.existsSync(databasePath) || fs.existsSync(manifestPath)) {
      throw new AppError('BACKUP_FAILED', '同名备份已经存在。');
    }

    let source: DatabaseSync | undefined;
    try {
      source = new DatabaseSync(this.#options.databasePath, { readOnly: true });
      await backup(source, temporaryDatabase);
      source.close();
      source = undefined;
      const stored: StoredManifest = Object.freeze({
        appId: this.#options.appId,
        appVersion: this.#options.appVersion,
        schemaVersion: this.#options.schemaVersion,
        createdAt: createdAt.toISOString(),
        fileName: path.basename(databasePath),
        sha256: sha256(temporaryDatabase),
        size: fs.statSync(temporaryDatabase).size
      });
      fs.writeFileSync(temporaryManifest, JSON.stringify(stored, null, 2), 'utf8');
      fs.renameSync(temporaryDatabase, databasePath);
      fs.renameSync(temporaryManifest, manifestPath);
      this.#options.controller.current().transaction((connection) => {
        connection.prepare([
          'INSERT INTO sys_backup_manifest',
          '(file_name, sha256, schema_version, app_version, created_by, created_at)',
          'VALUES (?, ?, ?, ?, ?, ?)'
        ].join(' ')).run(
          stored.fileName,
          stored.sha256,
          stored.schemaVersion,
          stored.appVersion,
          actor.userId,
          stored.createdAt
        );
        this.#options.audit.append(connection, {
          actor,
          permission: 'maintenance.backup',
          result: 'success',
          details: { fileName: stored.fileName, sha256: stored.sha256 }
        });
      });
      return Object.freeze({ ...stored, databasePath, manifestPath });
    } catch (cause) {
      source?.close();
      for (const candidate of [temporaryDatabase, temporaryManifest, databasePath, manifestPath]) {
        if (fs.existsSync(candidate)) fs.rmSync(candidate, { force: true });
      }
      if (cause instanceof AppError) throw cause;
      throw new AppError('BACKUP_FAILED', '创建备份失败。', { cause });
    }
  }

  inspectBackup(databasePath: string, manifestPath: string): BackupInspection {
    try {
      if (!fs.statSync(databasePath).isFile() || !fs.statSync(manifestPath).isFile()) {
        throw new Error('backup files are not regular files');
      }
      const manifest = readManifest(manifestPath);
      if (manifest.appId !== this.#options.appId) throw new Error('application ID mismatch');
      if (manifest.schemaVersion > this.#options.schemaVersion) throw new Error('future schema version');
      if (manifest.fileName !== path.basename(databasePath)) throw new Error('file name mismatch');
      if (manifest.size !== fs.statSync(databasePath).size) throw new Error('file size mismatch');
      if (manifest.sha256 !== sha256(databasePath)) throw new Error('digest mismatch');
      const database = new DatabaseSync(databasePath, { readOnly: true });
      try {
        const row = database.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
        if (row.integrity_check !== 'ok') throw new Error('integrity check failed');
      } finally {
        database.close();
      }
      return Object.freeze({ valid: true, databasePath, manifestPath, manifest });
    } catch (cause) {
      if (cause instanceof AppError) throw cause;
      throw new AppError('RESTORE_FAILED', '备份未通过恢复检查。', { cause });
    }
  }

  restoreBackup(
    inspection: BackupInspection,
    confirmation: string,
    actor: ActorDto
  ): RestoreResult {
    this.#options.permissions.require(actor, 'maintenance.restore');
    if (confirmation !== this.#options.appId) {
      throw new AppError('RESTORE_FAILED', '恢复确认信息不匹配。');
    }
    const checked = this.inspectBackup(inspection.databasePath, inspection.manifestPath);
    const suffix = stamp((this.#options.now ?? (() => new Date()))());
    const protectionPath = `${this.#options.databasePath}.pre-restore-${suffix}`;
    const temporaryPath = `${this.#options.databasePath}.restore-tmp`;
    if (fs.existsSync(protectionPath) || fs.existsSync(temporaryPath)) {
      throw new AppError('RESTORE_FAILED', '恢复保护文件已存在。');
    }

    let protectedCurrent = false;
    try {
      this.#options.controller.close();
      fs.renameSync(this.#options.databasePath, protectionPath);
      protectedCurrent = true;
      fs.copyFileSync(checked.databasePath, temporaryPath, fs.constants.COPYFILE_EXCL);
      fs.renameSync(temporaryPath, this.#options.databasePath);
      const database = this.#options.controller.reopen();
      if (!database.integrityCheck()) throw new Error('restored database integrity check failed');
      database.transaction((connection) => {
        this.#options.audit.append(connection, {
          actor,
          permission: 'maintenance.restore',
          result: 'success',
          details: { fileName: checked.manifest.fileName, sha256: checked.manifest.sha256 }
        });
      });
      return Object.freeze({ restored: true, protectionPath });
    } catch (cause) {
      try { this.#options.controller.close(); } catch { }
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
      if (protectedCurrent) {
        if (fs.existsSync(this.#options.databasePath)) fs.rmSync(this.#options.databasePath, { force: true });
        fs.renameSync(protectionPath, this.#options.databasePath);
        this.#options.controller.reopen();
      }
      throw new AppError('RESTORE_FAILED', '恢复失败，已保留原数据库。', { cause });
    }
  }
}
