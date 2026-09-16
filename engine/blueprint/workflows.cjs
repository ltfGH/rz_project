'use strict';

const { issue } = require('./issues.cjs');

function walk(startValues, adjacency) {
  const visited = new Set(startValues);
  const queue = [...startValues];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of adjacency.get(current) || []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}

function addEdge(adjacency, from, to) {
  if (!adjacency.has(from)) adjacency.set(from, []);
  adjacency.get(from).push(to);
}

function validateWorkflows(blueprint) {
  const issues = [];
  const assignedPermissions = new Set(
    blueprint.roles.flatMap((role) => role.permissions)
  );

  blueprint.workflows.forEach((workflow, workflowPosition) => {
    const workflowPath = `/workflows/${workflowPosition}`;
    const statePositions = new Map();
    workflow.states.forEach((state, statePosition) => {
      if (statePositions.has(state)) {
        issues.push(issue(
          'WORKFLOW_STATE_DUPLICATE',
          `${workflowPath}/states/${statePosition}`,
          `Workflow '${workflow.id}' contains duplicate state '${state}'.`
        ));
      } else {
        statePositions.set(state, statePosition);
      }
    });

    const hasInitialState = statePositions.has(workflow.initialState);
    if (!hasInitialState) {
      issues.push(issue(
        'WORKFLOW_INITIAL_STATE_UNKNOWN',
        `${workflowPath}/initialState`,
        `Workflow '${workflow.id}' has unknown initial state '${workflow.initialState}'.`
      ));
    }

    const validTerminalStates = [];
    workflow.terminalStates.forEach((state, terminalPosition) => {
      if (!statePositions.has(state)) {
        issues.push(issue(
          'WORKFLOW_TERMINAL_STATE_UNKNOWN',
          `${workflowPath}/terminalStates/${terminalPosition}`,
          `Workflow '${workflow.id}' has unknown terminal state '${state}'.`
        ));
      } else {
        validTerminalStates.push(state);
      }
    });

    const transitionIds = new Set();
    const forward = new Map();
    const reverse = new Map();
    const executable = new Map();
    workflow.transitions.forEach((transition, transitionPosition) => {
      const transitionPath = `${workflowPath}/transitions/${transitionPosition}`;
      if (transitionIds.has(transition.id)) {
        issues.push(issue(
          'DUPLICATE_ID',
          `${transitionPath}/id`,
          `Workflow '${workflow.id}' contains duplicate transition ID '${transition.id}'.`
        ));
      } else {
        transitionIds.add(transition.id);
      }

      const hasFrom = statePositions.has(transition.from);
      const hasTo = statePositions.has(transition.to);
      if (!hasFrom) {
        issues.push(issue(
          'WORKFLOW_TRANSITION_STATE_UNKNOWN',
          `${transitionPath}/from`,
          `Transition '${transition.id}' has unknown source state '${transition.from}'.`
        ));
      }
      if (!hasTo) {
        issues.push(issue(
          'WORKFLOW_TRANSITION_STATE_UNKNOWN',
          `${transitionPath}/to`,
          `Transition '${transition.id}' has unknown target state '${transition.to}'.`
        ));
      }
      if (hasFrom && hasTo) {
        addEdge(forward, transition.from, transition.to);
        addEdge(reverse, transition.to, transition.from);
        if (assignedPermissions.has(transition.permission)) {
          addEdge(executable, transition.from, transition.to);
        }
      }
      if (!assignedPermissions.has(transition.permission)) {
        issues.push(issue(
          'WORKFLOW_PERMISSION_UNASSIGNED',
          `${transitionPath}/permission`,
          `No role is assigned permission '${transition.permission}' for transition '${transition.id}'.`
        ));
      }
    });

    if (hasInitialState) {
      const reachable = walk([workflow.initialState], forward);
      workflow.states.forEach((state, statePosition) => {
        if (!reachable.has(state)) {
          issues.push(issue(
            'WORKFLOW_STATE_UNREACHABLE',
            `${workflowPath}/states/${statePosition}`,
            `State '${state}' is unreachable from '${workflow.initialState}'.`
          ));
        }
      });

      if (validTerminalStates.length > 0) {
        const canFinish = walk(validTerminalStates, reverse);
        const terminalSet = new Set(validTerminalStates);
        workflow.states.forEach((state, statePosition) => {
          if (reachable.has(state) && !terminalSet.has(state) && !canFinish.has(state)) {
            issues.push(issue(
              'WORKFLOW_TERMINAL_UNREACHABLE',
              `${workflowPath}/states/${statePosition}`,
              `State '${state}' cannot reach a terminal state.`
            ));
          }
        });

        const executableReachable = walk([workflow.initialState], executable);
        if (!validTerminalStates.some((state) => executableReachable.has(state))) {
          issues.push(issue(
            'WORKFLOW_NO_EXECUTABLE_PATH',
            workflowPath,
            `Workflow '${workflow.id}' has no permission-assigned path from initial to terminal state.`
          ));
        }
      }
    }
  });

  return issues;
}

module.exports = { validateWorkflows };
