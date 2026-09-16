'use strict';

const { issue } = require('./issues.cjs');

function validateRetention(blueprint) {
  const issues = [];
  const entityIndex = new Map(blueprint.entities.map((entity) => [entity.id, entity]));

  blueprint.modules.forEach((module, modulePosition) => {
    const entity = entityIndex.get(module.entity);
    if (!entity) return;
    module.actions.forEach((action, actionPosition) => {
      const path = `/modules/${modulePosition}/actions/${actionPosition}`;
      if (entity.history && action === 'delete') {
        issues.push(issue(
          'HISTORY_DELETE_FORBIDDEN',
          path,
          `History entity '${entity.id}' cannot expose delete.`
        ));
        return;
      }
      const appendOnlyWrite = entity.retention === 'append_only' && (
        action === 'update' ||
        action === 'delete' ||
        (action === 'create' && !entity.systemManaged)
      );
      if (appendOnlyWrite) {
        issues.push(issue(
          'RETENTION_ACTION_FORBIDDEN',
          path,
          `Append-only entity '${entity.id}' cannot expose action '${action}'.`
        ));
      }
    });
  });

  blueprint.entities.forEach((entity, entityPosition) => {
    const fieldIndex = new Map(entity.fields.map((field) => [field.id, field]));
    entity.relations.forEach((relation, relationPosition) => {
      const reasons = [];
      const sourceField = fieldIndex.get(relation.field);
      const targetEntity = entityIndex.get(relation.targetEntity);
      if (relation.onDelete === 'set_null' && sourceField && sourceField.required) {
        reasons.push('required relations cannot use set_null');
      }
      if (entity.history && relation.onDelete !== 'restrict') {
        reasons.push('history entities must restrict parent deletion');
      }
      if (
        relation.onDelete === 'cascade' &&
        targetEntity &&
        (targetEntity.history || targetEntity.retention === 'append_only')
      ) {
        reasons.push('cascade cannot target history or append-only entities');
      }
      if (reasons.length > 0) {
        issues.push(issue(
          'RELATION_DELETE_POLICY_INVALID',
          `/entities/${entityPosition}/relations/${relationPosition}/onDelete`,
          `Relation '${relation.id}' is unsafe: ${reasons.join('; ')}.`
        ));
      }
    });
  });

  return issues;
}

module.exports = { validateRetention };
