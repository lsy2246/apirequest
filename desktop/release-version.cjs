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

parse(version);
const tag = process.env.RELEASE_TAG;
if (tag !== `v${version}`) {
  throw new Error(`Release tag must match desktop/package.json (expected v${version}, received ${tag})`);
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
if (git('rev-parse', `refs/tags/${tag}^{commit}`) !== commit) {
  throw new Error('Checkout must match the release tag');
}
try {
  git('merge-base', '--is-ancestor', commit, 'refs/remotes/origin/master');
} catch {
  throw new Error('Release commit must belong to master');
}
appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ncommit=${commit}\n`);
