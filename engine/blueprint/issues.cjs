'use strict';

const SEVERITIES = new Set(['error', 'warning', 'info']);

function issue(code, path, message, severity = 'error') {
  if (!SEVERITIES.has(severity)) {
    throw new Error(`Unsupported issue severity '${severity}'.`);
  }
  return Object.freeze({ code, path, message, severity });
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sortIssues(issues) {
  return [...issues].sort((left, right) => (
    compareText(left.path, right.path) ||
    compareText(left.code, right.code) ||
    compareText(left.message, right.message)
  ));
}

function summarizeIssues(issues, maxLength = 12000) {
  if (!Number.isInteger(maxLength) || maxLength < 0) {
    throw new Error('Summary maximum length must be a non-negative integer.');
  }
  const summary = sortIssues(issues)
    .map((entry) => `[${entry.code}] ${entry.path}: ${entry.message}`)
    .join('\n');
  return summary.slice(0, maxLength);
}

module.exports = { issue, sortIssues, summarizeIssues };
