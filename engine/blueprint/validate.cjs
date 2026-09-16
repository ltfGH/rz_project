'use strict';

const validateStructure = require('./generated/validate-blueprint-structure.cjs');
const { loadCatalog } = require('./catalog.cjs');
const { issue, sortIssues, summarizeIssues } = require('./issues.cjs');
const { validateReferences } = require('./references.cjs');
const { validateWorkflows } = require('./workflows.cjs');
const { validateRetention } = require('./retention.cjs');

const defaultCatalog = loadCatalog();

function keywordCode(keyword) {
  return `SCHEMA_${keyword.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}`;
}

function pointerFor(error) {
  if (error.keyword === 'required') {
    return `${error.instancePath}/${error.params.missingProperty}` || '/';
  }
  if (error.keyword === 'additionalProperties') {
    return `${error.instancePath}/${error.params.additionalProperty}` || '/';
  }
  return error.instancePath || '/';
}

function structuralIssues() {
  return (validateStructure.errors || []).map((error) => issue(
    keywordCode(error.keyword),
    pointerFor(error),
    error.message || `Schema keyword '${error.keyword}' failed.`
  ));
}

function freezeResult(result) {
  Object.freeze(result.issues);
  return Object.freeze(result);
}

function validateBlueprint(value, options = {}) {
  const schemaVersion = value && typeof value.schemaVersion === 'string'
    ? value.schemaVersion
    : null;
  if (!validateStructure(value)) {
    const issues = sortIssues(structuralIssues());
    return freezeResult({
      valid: false,
      canGenerate: false,
      schemaVersion,
      issues,
      summary: summarizeIssues(issues)
    });
  }

  const catalog = options.catalog || defaultCatalog;
  const issues = sortIssues([
    ...validateReferences(value, catalog),
    ...validateWorkflows(value),
    ...validateRetention(value)
  ]);
  const canGenerate = issues.every((entry) => entry.severity !== 'error');
  return freezeResult({
    valid: true,
    canGenerate,
    schemaVersion,
    issues,
    summary: summarizeIssues(issues)
  });
}

module.exports = { validateBlueprint };
