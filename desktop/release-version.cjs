const { execFileSync } = require('node:child_process');
const { appendFileSync } = require('node:fs');
const { version } = require('./package.json');

function parse(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})\.(0|[1-9]\d{0,4})$/.test(value)) {
    throw new Error(`Invalid desktop version: ${value}`);
  }
  const parts = value.split('.').map(Number);
  if (parts.some((part) => part > 65535)) throw new Error(`Invalid desktop version: ${value}`);
  return parts;
}

const next = parse(version);
const before = process.env.BASE_SHA;
if (!/^[a-f0-9]{40}$/.test(before ?? '')) throw new Error('Invalid base commit');
let previous;
if (before !== '0'.repeat(40)) {
  const files = execFileSync('git', ['ls-tree', '--name-only', before, '--', 'desktop/package.json'], { encoding: 'utf8' });
  if (files.trim()) {
    previous = JSON.parse(execFileSync('git', ['show', `${before}:desktop/package.json`], { encoding: 'utf8' })).version;
    const current = parse(previous);
    const firstDifference = next.findIndex((part, index) => part !== current[index]);
    if (firstDifference !== -1 && next[firstDifference] < current[firstDifference]) {
      throw new Error(`Desktop version cannot go backwards (${previous} to ${version})`);
    }
  }
}
appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\nchanged=${version !== previous}\n`);
