const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

function repository(t, version = '0.1.1') {
  const cwd = mkdtempSync(join(tmpdir(), 'apirequest-release-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'master');
  git('config', 'user.name', 'Release test');
  git('config', 'user.email', 'release-test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'tag.gpgsign', 'false');
  mkdirSync(join(cwd, 'desktop'));
  copyFileSync(join(__dirname, 'release-version.cjs'), join(cwd, 'desktop/release-version.cjs'));
  writeFileSync(join(cwd, 'desktop/package.json'), JSON.stringify({ version }));
  git('add', 'desktop');
  git('commit', '-m', 'Prepare desktop release');
  git('update-ref', 'refs/remotes/origin/master', 'HEAD');
  const commit = git('rev-parse', 'HEAD');
  return {
    git, commit,
    validate(tag) {
      const output = join(cwd, 'github-output');
      const result = spawnSync(process.execPath, ['desktop/release-version.cjs'], {
        cwd, encoding: 'utf8',
        env: { ...process.env, RELEASE_TAG: tag ?? '', GITHUB_OUTPUT: output },
      });
      return { ...result, output: existsSync(output) ? readFileSync(output, 'utf8') : '' };
    },
  };
}

for (const annotated of [false, true]) {
  test(`accepts a matching ${annotated ? 'annotated' : 'lightweight'} tag on master`, (t) => {
    const repo = repository(t);
    repo.git('tag', ...(annotated ? ['-a', 'v0.1.1', '-m', 'Release'] : ['v0.1.1']));
    if (annotated) assert.notEqual(repo.git('rev-parse', 'v0.1.1'), repo.commit);
    repo.git('checkout', '--detach', 'v0.1.1');
    const result = repo.validate('v0.1.1');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.output, `version=0.1.1\ncommit=${repo.commit}\n`);
  });
}

test('accepts a release commit after master has advanced', (t) => {
  const repo = repository(t);
  repo.git('tag', 'v0.1.1');
  repo.git('commit', '--allow-empty', '-m', 'Next change');
  repo.git('update-ref', 'refs/remotes/origin/master', 'HEAD');
  repo.git('checkout', '--detach', 'v0.1.1');
  const result = repo.validate('v0.1.1');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, `version=0.1.1\ncommit=${repo.commit}\n`);
});

for (const tag of [undefined, '0.1.1', 'v0.1.2', 'v0.1.1-beta.1']) {
  test(`rejects a missing or mismatched release tag: ${tag}`, (t) => {
    const result = repository(t).validate(tag);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Release tag must match desktop\/package.json/);
    assert.equal(result.output, '');
  });
}

for (const version of ['01.1.1', '0.1.1-beta.1', '65536.0.0', '0.1', '0.1.1\ncommit=injected']) {
  test(`rejects invalid installer version: ${JSON.stringify(version)}`, (t) => {
    const result = repository(t, version).validate(`v${version}`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid desktop version/);
    assert.equal(result.output, '');
  });
}

test('rejects a release tag on a commit outside master', (t) => {
  const repo = repository(t);
  repo.git('checkout', '-b', 'unmerged-feature');
  repo.git('commit', '--allow-empty', '-m', 'Unmerged change');
  repo.git('tag', 'v0.1.1');
  repo.git('checkout', '--detach', 'v0.1.1');
  const result = repo.validate('v0.1.1');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Release commit must belong to master/);
  assert.equal(result.output, '');
});

test('rejects a checkout that differs from the release tag', (t) => {
  const repo = repository(t);
  repo.git('tag', 'v0.1.1');
  repo.git('commit', '--allow-empty', '-m', 'Different checkout');
  const result = repo.validate('v0.1.1');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Checkout must match the release tag/);
  assert.equal(result.output, '');
});
