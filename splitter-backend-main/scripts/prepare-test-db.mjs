// npm run test:db  - creates/updates the separate "splitter_test" database (prisma migrate deploy; Prisma creates the DB if missing)
import { spawnSync } from "node:child_process";
import { testDatabaseUrl, testRoot } from "./test-env.mjs";

const r = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  cwd: testRoot,
  env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
  stdio: "inherit",
});
process.exit(r.status ?? 1);
