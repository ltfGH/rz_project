return async function runStandardSmoke() {
  const { electron, initialApp, initialPage, userData, fs, path } = globalThis.__standardE2eContext;
  const { spawnSync } = process.getBuiltinModule('node:child_process');
  const crypto = process.getBuiltinModule('node:crypto');
  const executablePath = path.resolve(process.env.RZ_E2E_EXECUTABLE_PATH);
  const receiptPath = path.resolve(process.env.RZ_E2E_RECEIPT_PATH);
  const templateId = process.env.RZ_E2E_TEMPLATE_ID;
  const passwords = {
    dispatcher: process.env.RZ_E2E_DISPATCHER_PASSWORD,
    operator: process.env.RZ_E2E_OPERATOR_PASSWORD,
    reviewer: process.env.RZ_E2E_REVIEWER_PASSWORD,
    administrator: process.env.RZ_E2E_ADMINISTRATOR_PASSWORD
  };
  const unwrap = (value) => { if (!value.ok) throw new Error(JSON.stringify(value.error)); return value.data; };
  const login = (page, user, password) => page.evaluate(([u, p]) => window.businessApi.session.login(u, p), [user, password]).then(unwrap);
  let app = initialApp;
  try {
    let page = initialPage;
    for (const [username, password] of Object.entries(passwords)) {
      const session = await login(page, username, password);
      const metadata = unwrap(await page.evaluate((token) => window.businessApi.metadata.read(token), session.token));
      if (!Array.isArray(metadata.modules) || metadata.modules.length < 2) throw new Error(`${username} received no modules.`);
      unwrap(await page.evaluate((token) => window.businessApi.dashboard.read(token), session.token));
      if (username === 'administrator') {
        const module = metadata.modules.find((entry) => entry.id !== 'maintenance');
        const listed = unwrap(await page.evaluate(([token, entity]) => window.businessApi.entities.list(token, entity, { page: 1, pageSize: 5 }), [session.token, module.entity]));
        if (listed.total < 1) throw new Error('Seeded entity list is empty.');
      }
    }
    await page.getByLabel('账号').fill('administrator');
    await page.getByLabel('密码').fill(passwords.administrator);
    await page.getByRole('button', { name: '登录' }).click();
    await page.getByRole('navigation', { name: '主导航' }).waitFor();
    await app.close(); app = undefined;
    const check = spawnSync(process.execPath, ['-e', "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1],{readOnly:true});const tables=d.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'biz_%'\").all();let n=0;for(const t of tables)n+=Number(d.prepare('SELECT COUNT(*) count FROM '+t.name).get().count);d.close();if(n!==1000){console.error(n);process.exit(1)}", path.join(userData, 'runtime.sqlite')], { encoding: 'utf8', windowsHide: true });
    if (check.status !== 0) throw new Error(check.stderr || check.stdout || 'Business row count check failed.');
    app = await electron.launch({ executablePath, env: { ...process.env, RZ_RUNTIME_USER_DATA: userData } });
    page = await app.firstWindow();
    const restarted = await login(page, 'administrator', passwords.administrator);
    unwrap(await page.evaluate((token) => window.businessApi.metadata.read(token), restarted.token));
    await app.close(); app = undefined;
    const manifest = path.join(path.dirname(executablePath), 'resources', 'runtime-resources', 'resource-manifest.json');
    const hash = (filename) => crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, JSON.stringify({ status: 'passed', templateId, restartPersistence: true, executableSha256: hash(executablePath), resourceManifestSha256: hash(manifest) }, null, 2));
  } finally { if (app) await app.close().catch(() => undefined); }
};
