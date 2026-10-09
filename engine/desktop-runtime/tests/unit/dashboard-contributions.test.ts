import assert from 'node:assert/strict';
import test from 'node:test';

let subject: Record<string, unknown> = {};
try { subject = require('../../src/core/dashboard-contributions.ts') as Record<string, unknown>; } catch {}

const parse = subject.parseDashboardContributions as undefined | ((ui: unknown, actions: unknown, blueprint: unknown) => readonly any[]);
const normalize = subject.normalizeDashboardSection as undefined | ((definition: any, raw: unknown) => unknown);
const ready = typeof parse === 'function' && typeof normalize === 'function';

const blueprint = Object.freeze({
  schemaVersion: '1.0', software: Object.freeze({ id: 'fixture' }), plugins: Object.freeze([]),
  modules: Object.freeze([
    Object.freeze({ id: 'projects', name: '项目管理', route: '/projects', entity: 'project', actions: Object.freeze(['list','view']) }),
    Object.freeze({ id: 'project_tasks', name: '项目任务', route: '/tasks', entity: 'project_task', actions: Object.freeze(['list','view']) })
  ])
});

const actionValue = Object.freeze({
  id: 'project.dashboard_summary', permission: 'projects.summary',
  parse: (payload: Record<string, unknown>) => {
    if (Object.keys(payload).length !== 0) throw new Error('empty payload required');
    return Object.freeze({});
  },
  execute: () => Object.freeze({})
});

const domainActions = Object.freeze({
  'project.dashboard_summary': Object.freeze({ id:'project.dashboard_summary', pluginId:'project_task', value:actionValue })
});

function sectionValue() {
  return {
    id:'project.dashboard', slot:'dashboard.sections', label:'项目概览', order:20,
    viewId:'project_dashboard', dataSource:'project.dashboard_summary',
    presentation:{groups:[
      {id:'project_status',label:'项目状态',kind:'status',items:[
        {id:'planning',sourceKey:'planning',label:'规划中',tone:'neutral',moduleId:'projects'},
        {id:'active',sourceKey:'active',label:'进行中',tone:'teal',moduleId:'projects'}
      ]},
      {id:'project_attention',label:'需要关注',kind:'attention',items:[
        {id:'pending_task_reviews',sourceKey:'pendingTaskReviews',label:'待验收任务',tone:'amber',moduleId:'project_tasks'}
      ]}
    ]}
  };
}

const contributions = (value: unknown = sectionValue()) => Object.freeze({
  project: Object.freeze({ id:'project.dashboard', pluginId:'project_task', value })
});

function incompatible(action: () => unknown): void {
  assert.throws(action, (error: any) => error?.code === 'BLUEPRINT_INCOMPATIBLE');
}

test('exports strict dashboard contribution functions', () => {
  assert.equal(typeof parse, 'function');
  assert.equal(typeof normalize, 'function');
});

test('normalizes one strict project dashboard contribution', { skip:!ready }, () => {
  const definitions = parse!(contributions(), domainActions, blueprint);
  assert.equal(definitions.length, 1);
  assert.deepEqual(normalize!(definitions[0], { planning:3, active:2, pendingTaskReviews:4 }), {
    id:'project_dashboard', label:'项目概览', order:20, groups:[
      {id:'project_status',label:'项目状态',kind:'status',items:[
        {id:'planning',label:'规划中',value:3,tone:'neutral',moduleId:'projects'},
        {id:'active',label:'进行中',value:2,tone:'teal',moduleId:'projects'}
      ]},
      {id:'project_attention',label:'需要关注',kind:'attention',items:[
        {id:'pending_task_reviews',label:'待验收任务',value:4,tone:'amber',moduleId:'project_tasks'}
      ]}
    ]
  });
  assert.equal(Object.isFrozen(definitions), true);
  assert.equal(Object.isFrozen(definitions[0]?.groups[0]?.items), true);
});

test('rejects malformed dashboard contribution descriptors', { skip:!ready }, () => {
  const cases: Array<[string, (value: any) => void, unknown?, unknown?]> = [
    ['unknown property', value => { value.extra = true; }],
    ['duplicate group id', value => { value.presentation.groups[1].id = 'project_status'; }],
    ['duplicate item id', value => { value.presentation.groups[0].items[1].id = 'planning'; }],
    ['unknown data source', value => { value.dataSource = 'project.missing_summary'; }],
    ['unknown module', value => { value.presentation.groups[0].items[0].moduleId = 'missing'; }]
  ];
  for (const [name, mutate] of cases) {
    const value = structuredClone(sectionValue()); mutate(value);
    void name;
    incompatible(() => parse!(contributions(value), domainActions, blueprint));
  }
  const mismatched = { ...actionValue, id:'project.other_summary' };
  incompatible(() => parse!(contributions(), {
    'project.dashboard_summary': { id:'project.dashboard_summary', pluginId:'project_task', value:mismatched }
  }, blueprint));
  const rejecting = { ...actionValue, parse:() => { throw new Error('input required'); } };
  incompatible(() => parse!(contributions(), {
    'project.dashboard_summary': { id:'project.dashboard_summary', pluginId:'project_task', value:rejecting }
  }, blueprint));
});

test('rejects missing and invalid summary values', { skip:!ready }, () => {
  const definition = parse!(contributions(), domainActions, blueprint)[0];
  for (const raw of [
    { planning:3, active:2 },
    { planning:-1, active:2, pendingTaskReviews:4 },
    { planning:Number.NaN, active:2, pendingTaskReviews:4 },
    { planning:'3', active:2, pendingTaskReviews:4 }
  ]) incompatible(() => normalize!(definition, raw));
});
