'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateWorkflows } = require('../../blueprint/workflows.cjs');
const { validBlueprint, clone } = require('./helpers.cjs');

function workOrderBlueprint() {
  const blueprint = validBlueprint();
  blueprint.modules[0] = {
    id: 'tickets',
    name: '工单协同',
    route: 'tickets',
    entity: 'asset',
    actions: ['list', 'assign', 'accept', 'resolve', 'close']
  };
  blueprint.roles = [
    { id: 'dispatcher', name: '调度', permissions: ['tickets.list', 'tickets.assign'] },
    { id: 'engineer', name: '工程师', permissions: ['tickets.list', 'tickets.accept', 'tickets.resolve'] },
    { id: 'reviewer', name: '复核人', permissions: ['tickets.list', 'tickets.close'] }
  ];
  blueprint.workflows = [{
    id: 'ticket_flow',
    name: '工单闭环',
    entity: 'asset',
    initialState: 'pending',
    terminalStates: ['closed'],
    states: ['pending', 'assigned', 'processing', 'review', 'closed'],
    transitions: [
      {
        id: 'assign', name: '分派', from: 'pending', to: 'assigned',
        permission: 'tickets.assign', conditions: [], actions: []
      },
      {
        id: 'accept', name: '受理', from: 'assigned', to: 'processing',
        permission: 'tickets.accept', conditions: [], actions: []
      },
      {
        id: 'resolve', name: '提交解决', from: 'processing', to: 'review',
        permission: 'tickets.resolve', conditions: [], actions: []
      },
      {
        id: 'close', name: '复核关闭', from: 'review', to: 'closed',
        permission: 'tickets.close', conditions: [], actions: []
      }
    ]
  }];
  return blueprint;
}

function expectIssue(blueprint, code, path) {
  const issues = validateWorkflows(blueprint);
  assert.ok(
    issues.some((entry) => entry.code === code && entry.path === path),
    `Expected ${code} at ${path}; got ${JSON.stringify(issues)}`
  );
}

test('accepts a workflow completed collectively by multiple roles', () => {
  assert.deepEqual(validateWorkflows(workOrderBlueprint()), []);
});

test('rejects duplicate state and transition IDs', () => {
  const duplicateState = workOrderBlueprint();
  duplicateState.workflows[0].states.push('pending');
  expectIssue(duplicateState, 'WORKFLOW_STATE_DUPLICATE', '/workflows/0/states/5');

  const duplicateTransition = workOrderBlueprint();
  duplicateTransition.workflows[0].transitions.push(
    clone(duplicateTransition.workflows[0].transitions[0])
  );
  expectIssue(duplicateTransition, 'DUPLICATE_ID', '/workflows/0/transitions/4/id');
});

test('rejects missing initial and terminal states', () => {
  const missingInitial = workOrderBlueprint();
  missingInitial.workflows[0].initialState = 'missing';
  expectIssue(missingInitial, 'WORKFLOW_INITIAL_STATE_UNKNOWN', '/workflows/0/initialState');

  const missingTerminal = workOrderBlueprint();
  missingTerminal.workflows[0].terminalStates = ['missing'];
  expectIssue(missingTerminal, 'WORKFLOW_TERMINAL_STATE_UNKNOWN', '/workflows/0/terminalStates/0');
});

test('rejects transitions with unknown endpoints', () => {
  const missingFrom = workOrderBlueprint();
  missingFrom.workflows[0].transitions[0].from = 'missing';
  expectIssue(
    missingFrom,
    'WORKFLOW_TRANSITION_STATE_UNKNOWN',
    '/workflows/0/transitions/0/from'
  );

  const missingTo = workOrderBlueprint();
  missingTo.workflows[0].transitions[0].to = 'missing';
  expectIssue(
    missingTo,
    'WORKFLOW_TRANSITION_STATE_UNKNOWN',
    '/workflows/0/transitions/0/to'
  );
});

test('rejects states unreachable from the initial state', () => {
  const blueprint = workOrderBlueprint();
  blueprint.workflows[0].states.push('cancelled');

  expectIssue(blueprint, 'WORKFLOW_STATE_UNREACHABLE', '/workflows/0/states/5');
});

test('rejects reachable states that cannot reach a terminal state', () => {
  const blueprint = workOrderBlueprint();
  blueprint.workflows[0].states.push('blocked');
  blueprint.workflows[0].transitions.push({
    id: 'block', name: '阻塞', from: 'processing', to: 'blocked',
    permission: 'tickets.resolve', conditions: [], actions: []
  });

  expectIssue(blueprint, 'WORKFLOW_TERMINAL_UNREACHABLE', '/workflows/0/states/5');
});

test('rejects transitions whose permission is assigned to no role', () => {
  const blueprint = workOrderBlueprint();
  blueprint.roles[2].permissions = ['tickets.list'];

  expectIssue(
    blueprint,
    'WORKFLOW_PERMISSION_UNASSIGNED',
    '/workflows/0/transitions/3/permission'
  );
  expectIssue(blueprint, 'WORKFLOW_NO_EXECUTABLE_PATH', '/workflows/0');
});
