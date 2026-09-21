return async function runInventoryApplicationFlow() {
  const { initialApp, initialPage, userData, path } = globalThis.__inventoryE2eContext;
  const { spawnSync } = process.getBuiltinModule('node:child_process');
  const unwrap = (value) => { if (!value.ok) throw new Error(JSON.stringify(value.error)); return value.data; };
  const invoke = (page, method, args) => page.evaluate(async ([name, values]) => {
    if (name === 'login') return window.businessApi.session.login(values[0], values[1]);
    if (name === 'domain') return window.businessApi.domain.execute(values[0], values[1], values[2]);
    if (name === 'list') return window.businessApi.entities.list(values[0], values[1], values[2]);
    if (name === 'get') return window.businessApi.entities.get(values[0], values[1], values[2]);
    throw new Error('Unknown API method.');
  }, [method, args]);
  let app = initialApp;
  try {
    const page = initialPage;
    const dispatcher = unwrap(await invoke(page, 'login', ['dispatcher', process.env.RZ_E2E_DISPATCHER_PASSWORD]));
    const reviewer = unwrap(await invoke(page, 'login', ['reviewer', process.env.RZ_E2E_REVIEWER_PASSWORD]));
    const batches = unwrap(await invoke(page, 'list', [dispatcher.token, 'inventory_batch', { page: 1, pageSize: 5 }])).items;
    if (!batches.length) throw new Error('No inventory batch is available.');
    const batch = batches[0];
    const before = Number(batch.values.quantity);
    const application = unwrap(await invoke(page, 'domain', [dispatcher.token, 'inventory.application.create', {
      batchCode: batch.values.code, quantity: 3, purpose: 'E2E maintenance issue', title: 'E2E inventory application', content: 'Issue three units for verified maintenance.'
    }]));
    const submitted = unwrap(await invoke(page, 'domain', [dispatcher.token, 'application.submit', {
      applicationId: application.applicationId, expectedVersion: application.version, comment: 'Submit E2E issue'
    }]));
    const nodes = unwrap(await invoke(page, 'list', [reviewer.token, 'approval_node', {
      page: 1, pageSize: 10, filters: [{ field: 'application_code', operator: 'eq', value: application.applicationCode }]
    }])).items;
    const node = nodes.find((entry) => entry.values.status === 'active');
    if (!node) throw new Error('Active approval node was not found.');
    const approved = unwrap(await invoke(page, 'domain', [reviewer.token, 'application.approve', {
      applicationId: application.applicationId, expectedApplicationVersion: submitted.version,
      nodeId: node.id, expectedNodeVersion: node.version, comment: 'Approve E2E issue'
    }]));
    if (approved.status !== 'approved') throw new Error('Application was not approved.');
    const updated = unwrap(await invoke(page, 'get', [reviewer.token, 'inventory_batch', batch.id]));
    if (Number(updated.values.quantity) !== before - 3) throw new Error('Inventory quantity was not deducted exactly once.');
    const duplicate = await invoke(page, 'domain', [reviewer.token, 'application.approve', {
      applicationId: application.applicationId, expectedApplicationVersion: submitted.version,
      nodeId: node.id, expectedNodeVersion: node.version, comment: 'Duplicate approval'
    }]);
    if (duplicate.ok) throw new Error('Duplicate approval unexpectedly succeeded.');
    const afterDuplicate = unwrap(await invoke(page, 'get', [reviewer.token, 'inventory_batch', batch.id]));
    if (Number(afterDuplicate.values.quantity) !== before - 3) throw new Error('Duplicate approval changed inventory.');
    await app.close(); app = undefined;
    const check = spawnSync(process.execPath, ['-e', "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1],{readOnly:true});const a=d.prepare(\"SELECT COUNT(*) count FROM biz_application_inventory_issue WHERE application_code=?\").get(process.argv[2]).count,q=Number(d.prepare(\"SELECT quantity FROM biz_inventory_batch WHERE code=?\").get(process.argv[3]).quantity);d.close();if(a!==1||q!==Number(process.argv[4]))process.exit(1);", path.join(userData, 'runtime.sqlite'), application.applicationCode, String(batch.values.code), String(before - 3)], { encoding: 'utf8', windowsHide: true });
    if (check.status !== 0) throw new Error(check.stderr || check.stdout || 'Inventory application SQLite check failed.');
  } finally { if (app) await app.close().catch(() => undefined); }
};
