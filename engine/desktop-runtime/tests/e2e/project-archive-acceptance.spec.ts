import { test, expect, _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test.skip(process.env.RZ_E2E_TEMPLATE_ID !== 'project_delivery_archive' || !process.env.RZ_E2E_EXECUTABLE_PATH || !process.env.RZ_E2E_REVIEWER_PASSWORD, 'Project archive package is unavailable.');

test('accepted project delivery links to one ready archive file', async () => {
  test.setTimeout(120_000);
  const root = path.resolve(__dirname, '..', '..');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-runtime-e2e-'));
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  fs.appendFileSync(path.join(root, 'test-results', 'e2e-temp-paths.txt'), `${userData}\n`, 'utf8');
  const app = await electron.launch({ executablePath: path.resolve(process.env.RZ_E2E_EXECUTABLE_PATH!), env: { ...process.env, RZ_RUNTIME_USER_DATA: userData } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByLabel('账号')).toBeVisible();
    const result = await page.evaluate(async (password) => {
      const unwrap = (value: any) => { if (!value.ok) throw new Error(JSON.stringify(value.error)); return value.data; };
      const session: any = unwrap(await window.businessApi.session.login('reviewer', password));
      const list = async (entityId: string, filters: any[]) => unwrap<any>(await window.businessApi.entities.list(session.token, entityId, { page: 1, pageSize: 100, filters })).items;
      const deliveries = await list('deliverable', [{ field: 'status', operator: 'eq', value: 'accepted' }]);
      const files = await list('file_version', [{ field: 'storage_status', operator: 'eq', value: 'ready' }]);
      if (!deliveries.length || !files.length) throw new Error('Accepted delivery or ready file is unavailable.');
      const projects = await list('project', [{ field: 'code', operator: 'eq', value: deliveries[0].values.project_code }]);
      const payload = { projectId: projects[0].id, deliverableId: deliveries[0].id, fileVersionCode: files[0].values.code };
      const first: any = unwrap(await window.businessApi.domain.execute(session.token, 'project.delivery.archive', payload));
      const second: any = unwrap(await window.businessApi.domain.execute(session.token, 'project.delivery.archive', payload));
      if (first.archiveCode !== second.archiveCode) throw new Error('Archive command is not idempotent.');
      return first;
    }, process.env.RZ_E2E_REVIEWER_PASSWORD!);
    await app.close();
    const check = spawnSync(process.execPath, ['-e', "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1],{readOnly:true});const n=d.prepare('SELECT COUNT(*) count FROM biz_project_delivery_archive WHERE code=?').get(process.argv[2]).count;d.close();if(n!==1)process.exit(1);", path.join(userData, 'runtime.sqlite'), result.archiveCode], { encoding: 'utf8', windowsHide: true });
    assert.equal(check.status, 0, check.stderr || check.stdout);
  } finally { await app.close().catch(() => undefined); }
});
