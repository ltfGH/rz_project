import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { RuntimeBlueprint } from '../shared/blueprint';
import type { StandardProjectConfig } from './standard-project';
import { applyThemeSeedVocabulary } from './theme-seed-aliases';

export interface StandardPasswordDigests {
  readonly dispatcher: string;
  readonly operator: string;
  readonly reviewer: string;
  readonly administrator: string;
}

export interface StandardRuntimeSeed {
  readonly formatVersion: '1.0';
  readonly seedId: string;
  readonly baseline: string;
  readonly users: readonly Readonly<{
    username: string; displayName: string; roleId: string; passwordDigest: string;
  }>[];
  readonly recordOrder: readonly string[];
  readonly records: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
  readonly report: Readonly<{
    countedBusinessRows: number;
    counts: Readonly<Record<string, number>>;
  }>;
}

function domainRoot(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'domain-packs'),
    path.resolve(__dirname, '..', '..', '..', '..', 'domain-packs')
  ];
  const found = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'packs')));
  if (!found) throw new Error('Production domain packs were not found.');
  return found;
}

function seedModule(packId: string): Record<string, unknown> {
  return require(path.join(domainRoot(), 'packs', packId, 'seed', 'index.ts')) as Record<string, unknown>;
}

function appendRecords(
  target: Record<string, Array<Record<string, unknown>>>,
  source: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>
): void {
  for (const [entity, rows] of Object.entries(source)) {
    if (!target[entity]) throw new Error(`Seed generator returned unknown entity '${entity}'.`);
    target[entity].push(...structuredClone(rows));
  }
}

function selected(project: StandardProjectConfig, id: string): boolean {
  return project.packs.some((pack) => pack.id === id);
}

function generateCoreRecords(project: StandardProjectConfig, records: Record<string, Array<Record<string, unknown>>>): void {
  const seed = project.seed.value;
  if (selected(project, 'asset_registry')) {
    const module = seedModule('asset_registry') as any;
    appendRecords(records, module.generateAssetSeed({ seed, categoryCount: 10, assetCount: 30 }).records);
  }
  if (selected(project, 'inspection_rectification')) {
    const module = seedModule('inspection_rectification') as any;
    appendRecords(records, module.generateInspectionSeed({ seed: seed + 1, planCount: 10, taskCount: 30 }).records);
  }
  if (selected(project, 'work_order_service')) {
    const module = seedModule('work_order_service') as any;
    appendRecords(records, module.generateWorkOrderSeed({ seed: seed + 2, serviceCount: 5, orderCount: 30 }).records);
  }
  if (selected(project, 'inventory_batch')) {
    const module = seedModule('inventory_batch') as any;
    appendRecords(records, module.generateInventorySeed({ seed: seed + 3, materialCount: 10, warehouseCount: 5, batchCount: 50 }).records);
  }
  if (selected(project, 'project_task')) {
    const module = seedModule('project_task') as any;
    appendRecords(records, module.generateProjectSeed({ seed: seed + 4, projectCount: 8, tasksPerProject: 4 }).records);
  }
  if (selected(project, 'application_archive')) {
    const module = seedModule('application_archive') as any;
    appendRecords(records, module.generateApplicationArchiveSeed({ seed: seed + 5, applicationCount: 20, certificateCount: 6 }).records);
    for (const application of records.application ?? []) application.current_node_code = null;
  }
}

function enrichBridgeRecords(project: StandardProjectConfig, records: Record<string, Array<Record<string, unknown>>>): void {
  const assets = records.asset ?? [];
  if (selected(project, 'asset_work_order_bridge') && assets.length > 0) {
    for (const [index, order] of (records.work_order ?? []).entries()) order.asset_code = assets[index % assets.length]!.code;
  }
  if (selected(project, 'asset_inspection_bridge') && assets.length > 0) {
    for (const [index, plan] of (records.inspection_plan ?? []).entries()) plan.asset_code = assets[index % assets.length]!.code;
    const plans = new Map((records.inspection_plan ?? []).map((plan) => [plan.code, plan]));
    for (const task of records.inspection_task ?? []) task.asset_code = plans.get(task.plan_code)?.asset_code ?? assets[0]!.code;
  }
  if (selected(project, 'inspection_work_order_bridge')) {
    const services = records.service_catalog ?? [];
    if (!services.some((row) => row.code === 'SVC-RECTIFICATION')) {
      services.push({ code: 'SVC-RECTIFICATION', name: 'Rectification Service', description: 'Inspection remediation', active: true });
      (records.sla_policy ?? []).push({
        code: 'SLA-RECTIFICATION', name: 'Rectification Policy', service_code: 'SVC-RECTIFICATION',
        priority: 'normal', response_minutes: 60, resolution_minutes: 480, active: true
      });
    }
    const abnormal = (records.inspection_item ?? []).filter((row) => row.result === 'abnormal');
    const orders = records.work_order ?? [];
    const links = records.inspection_work_order_link ?? [];
    for (let index = 0; index < Math.min(5, abnormal.length, orders.length); index += 1) {
      const item = abnormal[index]!;
      links.push({
        code: `IWL-SEED-${String(index + 1).padStart(4, '0')}`,
        inspection_task_code: item.task_code,
        inspection_item_code: item.code,
        work_order_code: orders[index]!.code,
        payload_digest: crypto.createHash('sha256').update(`${item.code}:${orders[index]!.code}`).digest('hex'),
        created_at_business: project.seed.baseline
      });
    }
  }
  if (selected(project, 'inventory_application_bridge')) {
    const batches = records.inventory_batch ?? [];
    for (const [index, application] of (records.application ?? []).entries()) {
      if (batches.length === 0 || index >= 5) break;
      application.inventory_batch_code = batches[index % batches.length]!.code;
      application.inventory_quantity = 1;
      application.inventory_purpose = 'Approved synthetic issue';
    }
  }
}

function fillerTarget(records: Record<string, Array<Record<string, unknown>>>): string {
  for (const candidate of ['asset', 'material', 'project', 'application', 'inspection_plan']) {
    if (records[candidate]) return candidate;
  }
  throw new Error('Standard template has no supported filler business entity.');
}

function appendFillers(records: Record<string, Array<Record<string, unknown>>>, count: number): void {
  const target = fillerTarget(records);
  const rows = records[target]!;
  for (let index = 0; index < count; index += 1) {
    const number = String(index + 1).padStart(4, '0');
    if (target === 'asset') rows.push({
      code: `AST-FILL-${number}`, name: `Synthetic Asset ${number}`,
      category_code: records.asset_category![0]!.code, status: 'active', location: 'Synthetic Area'
    });
    else if (target === 'material') rows.push({
      code: `MAT-FILL-${number}`, name: `Synthetic Material ${number}`, unit: 'unit', expiry_warning_days: 30, active: true
    });
    else if (target === 'project') rows.push({
      code: `PRJ-FILL-${number}`, name: `Synthetic Project ${number}`, manager_id: 'project-manager-01',
      status: 'planning', planned_start_at: '2026-09-01', planned_end_at: '2027-03-31', progress: 0,
      close_requested_by: null, close_requested_at: null, closed_by: null, closed_at: null
    });
    else if (target === 'application') rows.push({
      code: `APP-FILL-${number}`, application_type: 'general', title: `Synthetic Application ${number}`,
      content: 'Synthetic offline application', applicant_id: 'application-applicant-01', status: 'draft',
      approval_round: 0, current_node_code: null, submitted_at: null, approved_at: null, archived_at: null
    });
    else rows.push({
      code: `IPLAN-FILL-${number}`, name: `Synthetic Inspection Plan ${number}`, cycle_days: 30,
      instructions: 'Perform every inspection item.', active: true
    });
  }
}

function topologicalRecordOrder(
  blueprint: RuntimeBlueprint,
  records: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>
): string[] {
  const entities = blueprint.entities ?? [];
  const ids = entities.map((entity) => entity.id);
  const dependencies = new Map(entities.map((entity) => [entity.id, new Set(
    entity.fields.filter((field) => field.type === 'reference' && field.reference?.entity !== entity.id &&
      (records[entity.id] ?? []).some((row) => row[field.id] !== null && row[field.id] !== undefined))
      .map((field) => field.reference!.entity)
  )]));
  const result: string[] = [];
  while (result.length < ids.length) {
    const next = ids.find((id) => !result.includes(id) && [...(dependencies.get(id) ?? [])].every((dep) => result.includes(dep)));
    if (!next) throw new Error('Standard seed entity references contain a cycle.');
    result.push(next);
  }
  return result;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function generateStandardSeed(
  project: StandardProjectConfig,
  blueprint: RuntimeBlueprint,
  passwordDigests: StandardPasswordDigests
): StandardRuntimeSeed {
  const records = Object.fromEntries((blueprint.entities ?? []).map((entity) => [entity.id, []])) as Record<string, Array<Record<string, unknown>>>;
  generateCoreRecords(project, records);
  enrichBridgeRecords(project, records);
  const initialTotal = Object.values(records).reduce((sum, rows) => sum + rows.length, 0);
  if (initialTotal > project.seed.businessRows) throw new Error('Production seed generators exceeded the standard business row target.');
  appendFillers(records, project.seed.businessRows - initialTotal);
  applyThemeSeedVocabulary(records, project.profile.seedVocabulary);
  const order = topologicalRecordOrder(blueprint, records);
  const counts = Object.fromEntries(order.map((entity) => [entity, records[entity]!.length]));
  const users = [
    { username: 'dispatcher', roleId: 'operations_dispatcher', passwordDigest: passwordDigests.dispatcher },
    { username: 'operator', roleId: 'operations_operator', passwordDigest: passwordDigests.operator },
    { username: 'reviewer', roleId: 'operations_reviewer', passwordDigest: passwordDigests.reviewer },
    { username: 'administrator', roleId: 'operations_admin', passwordDigest: passwordDigests.administrator }
  ].map((user) => ({
    ...user,
    displayName: project.roleProfiles.find((role) => role.id === user.roleId)?.name ?? user.username
  }));
  const frozenRecords = Object.fromEntries(order.map((entity) => [entity, records[entity]!.map((row) => ({ ...row }))]));
  return deepFreeze({
    formatVersion: '1.0' as const,
    seedId: `standard-${project.templateId}-${project.seed.value}`,
    baseline: project.seed.baseline,
    users,
    recordOrder: order,
    records: frozenRecords,
    report: { countedBusinessRows: project.seed.businessRows, counts }
  });
}
