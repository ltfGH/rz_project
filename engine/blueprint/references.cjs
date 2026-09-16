'use strict';

const { issue } = require('./issues.cjs');

function indexById(items, collectionPath, issues) {
  const index = new Map();
  items.forEach((item, position) => {
    if (index.has(item.id)) {
      issues.push(issue(
        'DUPLICATE_ID',
        `${collectionPath}/${position}/id`,
        `Duplicate ID '${item.id}' in ${collectionPath}.`
      ));
    } else {
      index.set(item.id, item);
    }
  });
  return index;
}

function validatePermission(permission, path, moduleIndex, issues) {
  const separator = permission.indexOf('.');
  const moduleId = separator === -1 ? permission : permission.slice(0, separator);
  const action = separator === -1 ? '' : permission.slice(separator + 1);
  const module = moduleIndex.get(moduleId);
  if (!module) {
    issues.push(issue(
      'REFERENCE_MODULE_UNKNOWN',
      path,
      `Permission '${permission}' references unknown module '${moduleId}'.`
    ));
  } else if (!module.actions.includes(action)) {
    issues.push(issue(
      'REFERENCE_PERMISSION_UNKNOWN',
      path,
      `Permission '${permission}' is not declared by module '${moduleId}'.`
    ));
  }
}

function validateReferences(blueprint, catalog) {
  const issues = [];
  const entityIndex = indexById(blueprint.entities, '/entities', issues);
  const moduleIndex = indexById(blueprint.modules, '/modules', issues);
  indexById(blueprint.roles, '/roles', issues);
  indexById(blueprint.workflows, '/workflows', issues);
  indexById(blueprint.dashboards, '/dashboards', issues);
  indexById(blueprint.plugins, '/plugins', issues);

  const selectedArchetypes = new Set(blueprint.archetypes);
  const selectedCapabilities = new Set(blueprint.capabilities);
  blueprint.archetypes.forEach((archetypeId, position) => {
    const descriptor = catalog.archetypes.get(archetypeId);
    if (!descriptor) {
      issues.push(issue(
        'ARCHETYPE_UNKNOWN',
        `/archetypes/${position}`,
        `Unknown archetype '${archetypeId}'.`
      ));
      return;
    }
    for (const capability of descriptor.requiredCapabilities) {
      if (!selectedCapabilities.has(capability)) {
        issues.push(issue(
          'CAPABILITY_MISSING',
          '/capabilities',
          `Archetype '${archetypeId}' requires capability '${capability}'.`
        ));
      }
    }
  });

  blueprint.plugins.forEach((selection, position) => {
    const descriptor = catalog.plugins.get(selection.id);
    const basePath = `/plugins/${position}`;
    if (!descriptor) {
      issues.push(issue('PLUGIN_UNKNOWN', `${basePath}/id`, `Unknown plugin '${selection.id}'.`));
      return;
    }
    const compatible = descriptor.compatibleArchetypes.some((id) => selectedArchetypes.has(id));
    const allowed = [...selectedArchetypes].some((id) => {
      const archetype = catalog.archetypes.get(id);
      return archetype && archetype.allowedPlugins.includes(selection.id);
    });
    if (!compatible || !allowed) {
      issues.push(issue(
        'PLUGIN_INCOMPATIBLE',
        `${basePath}/id`,
        `Plugin '${selection.id}' is incompatible with the selected archetypes.`
      ));
    }
    const required = new Set(descriptor.configKeys.required);
    const allowedKeys = new Set([...required, ...descriptor.configKeys.optional]);
    for (const key of required) {
      if (!Object.hasOwn(selection.config, key)) {
        issues.push(issue(
          'PLUGIN_CONFIG_MISSING',
          `${basePath}/config/${key}`,
          `Plugin '${selection.id}' requires config key '${key}'.`
        ));
      }
    }
    for (const key of Object.keys(selection.config)) {
      if (!allowedKeys.has(key)) {
        issues.push(issue(
          'PLUGIN_CONFIG_UNKNOWN',
          `${basePath}/config/${key}`,
          `Plugin '${selection.id}' does not accept config key '${key}'.`
        ));
      }
    }
  });

  blueprint.modules.forEach((module, position) => {
    if (!entityIndex.has(module.entity)) {
      issues.push(issue(
        'REFERENCE_ENTITY_UNKNOWN',
        `/modules/${position}/entity`,
        `Module '${module.id}' references unknown entity '${module.entity}'.`
      ));
    }
  });

  blueprint.entities.forEach((entity, entityPosition) => {
    const fieldIndex = indexById(
      entity.fields,
      `/entities/${entityPosition}/fields`,
      issues
    );
    indexById(entity.relations, `/entities/${entityPosition}/relations`, issues);
    entity.fields.forEach((field, fieldPosition) => {
      if (field.type !== 'reference') return;
      const targetEntity = entityIndex.get(field.reference.entity);
      const basePath = `/entities/${entityPosition}/fields/${fieldPosition}/reference`;
      if (!targetEntity) {
        issues.push(issue(
          'REFERENCE_ENTITY_UNKNOWN',
          `${basePath}/entity`,
          `Field '${entity.id}.${field.id}' references unknown entity '${field.reference.entity}'.`
        ));
      } else if (!targetEntity.fields.some((candidate) => candidate.id === field.reference.field)) {
        issues.push(issue(
          'REFERENCE_FIELD_UNKNOWN',
          `${basePath}/field`,
          `Field '${entity.id}.${field.id}' references unknown field '${field.reference.entity}.${field.reference.field}'.`
        ));
      }
    });
    entity.relations.forEach((relation, relationPosition) => {
      const basePath = `/entities/${entityPosition}/relations/${relationPosition}`;
      if (!fieldIndex.has(relation.field)) {
        issues.push(issue(
          'REFERENCE_FIELD_UNKNOWN',
          `${basePath}/field`,
          `Relation '${relation.id}' uses unknown source field '${entity.id}.${relation.field}'.`
        ));
      }
      const targetEntity = entityIndex.get(relation.targetEntity);
      if (!targetEntity) {
        issues.push(issue(
          'REFERENCE_ENTITY_UNKNOWN',
          `${basePath}/targetEntity`,
          `Relation '${relation.id}' references unknown entity '${relation.targetEntity}'.`
        ));
      } else if (!targetEntity.fields.some((field) => field.id === relation.targetField)) {
        issues.push(issue(
          'REFERENCE_FIELD_UNKNOWN',
          `${basePath}/targetField`,
          `Relation '${relation.id}' references unknown field '${relation.targetEntity}.${relation.targetField}'.`
        ));
      }
    });
  });

  blueprint.roles.forEach((role, rolePosition) => {
    role.permissions.forEach((permission, permissionPosition) => {
      validatePermission(
        permission,
        `/roles/${rolePosition}/permissions/${permissionPosition}`,
        moduleIndex,
        issues
      );
    });
  });

  blueprint.workflows.forEach((workflow, workflowPosition) => {
    if (!entityIndex.has(workflow.entity)) {
      issues.push(issue(
        'REFERENCE_ENTITY_UNKNOWN',
        `/workflows/${workflowPosition}/entity`,
        `Workflow '${workflow.id}' references unknown entity '${workflow.entity}'.`
      ));
    }
    workflow.transitions.forEach((transition, transitionPosition) => {
      validatePermission(
        transition.permission,
        `/workflows/${workflowPosition}/transitions/${transitionPosition}/permission`,
        moduleIndex,
        issues
      );
    });
  });

  blueprint.dashboards.forEach((dashboard, dashboardPosition) => {
    const entity = entityIndex.get(dashboard.entity);
    const basePath = `/dashboards/${dashboardPosition}`;
    if (!entity) {
      issues.push(issue(
        'DASHBOARD_SOURCE_UNKNOWN',
        `${basePath}/entity`,
        `Dashboard '${dashboard.id}' references unknown entity '${dashboard.entity}'.`
      ));
      return;
    }
    const fields = new Set(entity.fields.map((field) => field.id));
    if (dashboard.field && !fields.has(dashboard.field)) {
      issues.push(issue(
        'DASHBOARD_SOURCE_UNKNOWN',
        `${basePath}/field`,
        `Dashboard '${dashboard.id}' references unknown field '${dashboard.entity}.${dashboard.field}'.`
      ));
    }
    dashboard.filters.forEach((filter, filterPosition) => {
      if (!fields.has(filter.field)) {
        issues.push(issue(
          'DASHBOARD_SOURCE_UNKNOWN',
          `${basePath}/filters/${filterPosition}/field`,
          `Dashboard '${dashboard.id}' filters unknown field '${dashboard.entity}.${filter.field}'.`
        ));
      }
    });
  });

  Object.keys(blueprint.demoData.entityMinimums).forEach((entityId) => {
    if (!entityIndex.has(entityId)) {
      issues.push(issue(
        'REFERENCE_ENTITY_UNKNOWN',
        `/demoData/entityMinimums/${entityId}`,
        `Demo data references unknown entity '${entityId}'.`
      ));
    }
  });

  blueprint.coverage.unsupported.forEach((requirement, position) => {
    issues.push(issue(
      'UNSUPPORTED_REQUIREMENT',
      `/coverage/unsupported/${position}`,
      `Unsupported requirement: ${requirement}`
    ));
  });

  return issues;
}

module.exports = { validateReferences };
