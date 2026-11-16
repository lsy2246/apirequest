const { spawnSync } = require("node:child_process");
const { rmSync, statSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const pnpm = process.env.npm_execpath;
if (!pnpm || !/pnpm\.(?:cjs|mjs|js)$/.test(pnpm)) {
  throw new Error("Run this bootstrap with pnpm ci:prepare");
}
const env = {
  ...process.env,
  // Schema generation does not start the application or connect to this database.
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder",
};

function run(args, extraEnv = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...env, ...extraEnv },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${args.join(" ")} failed (${result.status ?? result.signal})`);
  }
}
function command(...args) {
  console.log(`\nPreparing CI: pnpm ${args.join(" ")}`);
  run([pnpm, ...args]);
}

// Install without workspace lifecycle scripts, then build in dependency order.
command("rebuild", "esbuild", "@prisma/engines", "argon2");
command("--filter", "@apirequest/codemirror-lang-graphql", "run", "prepare");
command("--filter", "@apirequest/data", "run", "build");
command("--filter", "@apirequest/kernel", "run", "build");
command("--filter", "@apirequest/js-sandbox", "run", "build");
command("--filter", "apirequest-backend", "exec", "prisma", "generate");
command("--filter", "apirequest-backend", "run", "build");

const schema = join(root, "gql-gen", "backend-schema.gql");
rmSync(schema, { force: true });
console.log("\nPreparing CI: generate backend GraphQL schema");
run([join(root, "packages/apirequest-backend/dist/src/main.js")], {
  GENERATE_GQL_SCHEMA: "true",
  GQL_SCHEMA_EMIT_LOCATION: schema,
});
if (statSync(schema).size === 0) throw new Error("Backend GraphQL schema is empty");

command("--filter", "@apirequest/common", "run", "gql-codegen");
command("--filter", "@apirequest/selfhost-web", "run", "gql-codegen");
