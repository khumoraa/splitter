// Shared by the integration tests: builds the environment for a throw-away server + database.
// The database is a separate "splitter_test" next to your dev database (same Postgres server), so tests never touch real users.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readEnvFile() {
  const p = path.join(root, ".env");
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL || readEnvFile().DATABASE_URL;
  if (!base) throw new Error("Set TEST_DATABASE_URL or DATABASE_URL (in .env)");
  const u = new URL(base);
  u.pathname = "/splitter_test";
  return u.toString();
}

export const testRoot = root;
