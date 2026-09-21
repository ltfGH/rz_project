'use strict';

const fs = require('node:fs');
const path = require('node:path');
const validateStructure = require('./generated/validate-theme-profile-structure.cjs');

function finish(value, code) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
  process.exit(code);
}

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--profile' || !path.isAbsolute(args[1])) {
  finish({ valid: false, issues: ['profile argument must be one absolute path'] }, 2);
}
const filename = path.resolve(args[1]);
let stat;
try { stat = fs.lstatSync(filename); } catch { finish({ valid: false, issues: ['profile file does not exist'] }, 2); }
if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) {
  finish({ valid: false, issues: ['profile must be a regular file no larger than 64 KiB'] }, 2);
}
let profile;
try { profile = JSON.parse(fs.readFileSync(filename, 'utf8')); }
catch { finish({ valid: false, issues: ['profile is not valid JSON'] }, 1); }

const issues = [];
if (!validateStructure(profile)) {
  for (const error of validateStructure.errors ?? []) {
    issues.push(`schema${error.instancePath || '/'}: ${error.message}`);
  }
}
const unsafeKey = /^(?:__proto__|prototype|constructor|script|sql|command|expression|applicant|identity|contact|password|token|publication)$/i;
const unsafeValue = /[<>]|https?:\/\/|file:\/\/|www\.|\]\(|[A-Za-z]:[\\/]|(?:^|[\\/])\.\.(?:[\\/]|$)|\\|\b(?:select|insert|update|delete|drop|alter|pragma|attach\s+database|create\s+table|powershell|cmd\.exe|bash|script|command)\b/i;
function inspect(value, location) {
  if (typeof value === 'string') {
    if (unsafeValue.test(value)) issues.push(`${location}: unsafe text is not allowed`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspect(entry, `${location}/${index}`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (unsafeKey.test(key)) issues.push(`${location}/${key}: unsafe key is not allowed`);
      inspect(entry, `${location}/${key}`);
    }
  }
}
inspect(profile, 'profile');
if (issues.length > 0) finish({ valid: false, issues: [...new Set(issues)].sort() }, 1);
finish({ valid: true, issues: [], profile }, 0);
