const { spawnSync } = require('node:child_process');
const { mkdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const runtime = join(__dirname, '.native-runtime');
const pnpm = process.env.npm_execpath;
if (!pnpm || !/pnpm\.(?:cjs|mjs|js)$/.test(pnpm)) {
  throw new Error('Run with pnpm --dir desktop prepare:native');
}

// 桌面打包只加载本地静态界面，不接入开发环境的端点或凭证。
const buildEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith('VITE_') && key !== 'HOPP_ALLOW_RUNTIME_ENV'
));
Object.assign(buildEnv, {
  VITE_BASE_URL: 'tauri://localhost',
  WORKBENCH_NATIVE_BUILD: 'true',
});

function runNode(args, env = buildEnv, stdio = 'inherit') {
  const result = spawnSync(process.execPath, args, {
    cwd: root, env, stdio,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${args.join(' ')} failed (${result.status ?? result.signal})`);
}

function run(...args) {
  runNode([pnpm, '--fail-if-no-match', ...args]);
}

rmSync(runtime, { recursive: true, force: true });
mkdirSync(runtime);
run('--filter', '@apirequest/codemirror-lang-graphql', 'exec', 'rollup', '-c');
run('--filter', '@apirequest/data', 'run', 'build:code');
run('--filter', '@apirequest/kernel', 'run', 'build:code');
run('--filter', '@apirequest/js-sandbox', 'exec', 'vite', 'build');
run('--filter', '@apirequest/selfhost-web', 'run', 'build', '--outDir', runtime);
