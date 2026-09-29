import { test, expect, _electron as electron } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const required = ['RZ_E2E_EXECUTABLE_PATH', 'RZ_E2E_DISPATCHER_PASSWORD', 'RZ_E2E_REVIEWER_PASSWORD'];
test.skip(process.env.RZ_E2E_TEMPLATE_ID !== 'inventory_application_approval' || required.some((name) => !process.env[name]), 'Inventory application package is unavailable.');

test('approved inventory application deducts one batch exactly once', async () => {
  test.setTimeout(120_000);
  const root = path.resolve(__dirname, '..', '..');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-runtime-e2e-'));
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  fs.appendFileSync(path.join(root, 'test-results', 'e2e-temp-paths.txt'), `${userData}\n`, 'utf8');
  const captureRoot=process.env.RZ_E2E_WORKFLOW_CAPTURE_DIR?path.resolve(process.env.RZ_E2E_WORKFLOW_CAPTURE_DIR):undefined,captureEntries:Record<string,unknown>[]=[];
  const executablePath=path.resolve(process.env.RZ_E2E_EXECUTABLE_PATH!),captureEvidence=captureRoot?{executableSha256:crypto.createHash('sha256').update(fs.readFileSync(executablePath)).digest('hex'),blueprintSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(path.dirname(executablePath),'resources','runtime-resources','blueprint.json'))).digest('hex')}:undefined;
  const capture=async(page:import('@playwright/test').Page,entry:Record<string,unknown>)=>{if(!captureRoot)return;const scenarioId=String(entry.scenarioId??'');if(!/^[a-z][a-z0-9_]{1,63}$/.test(scenarioId))throw new Error('Workflow screenshot scenario is invalid.');const{controlLabel,...metadata}=entry,actionId=metadata.actionId??null;let controlVerified=false;if(actionId!==null){if(typeof controlLabel!=='string'||!controlLabel)throw new Error('Workflow action capture requires a control label.');const control=page.getByRole('button',{name:controlLabel,exact:true});controlVerified=await control.count()>0&&await control.first().isVisible();if(!controlVerified)throw new Error(`Workflow action control '${controlLabel}' is not visible.`);}fs.mkdirSync(captureRoot,{recursive:true});const fileName=`inventory-application-${scenarioId}.png`;await page.screenshot({path:path.join(captureRoot,fileName),fullPage:true});captureEntries.push({...metadata,...captureEvidence,scenarioId,fileName,controlVerified});const indexPath=path.join(captureRoot,'inventory-application.captures.json'),staging=`${indexPath}.tmp`;fs.writeFileSync(staging,JSON.stringify(captureEntries,null,2),'utf8');fs.renameSync(staging,indexPath);};
  const app = await electron.launch({ executablePath, env: { ...process.env, RZ_RUNTIME_USER_DATA: userData } });
  try {
    const page = await app.firstWindow();
    await expect(page.getByLabel('账号')).toBeVisible();
    const source = fs.readFileSync(path.join(root, 'tools', 'inventory-application-e2e.source.js'), 'utf8');
    const run = new Function(source)() as () => Promise<void>;
    (globalThis as any).__inventoryE2eContext = { initialApp: app, initialPage: page, userData, fs, path, capture };
    await run();
    delete (globalThis as any).__inventoryE2eContext;
  } finally { await app.close().catch(() => undefined); }
});
