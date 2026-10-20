#!/usr/bin/env node
/**
 * npm run dev:lan [-- <extra expo args>]
 *
 * 1. finds this computer's current LAN IP,
 * 2. sets EXPO_PUBLIC_API_URL=http://<ip>:<API_PORT|3001> in .env (only that line is changed),
 * 3. warns if the backend does not answer on that address,
 * 4. starts Expo with a cleared Metro cache (-c), advertising the same IP to Expo Go.
 *
 * Flags: --no-start  only update .env and print the result (nothing is launched)
 * Env:   API_PORT (default 3001), ENV_FILE (default ./.env), LAN_IP (override detection)
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickLanIp, readEnvVar, upsertEnvVar } from './env-file.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = process.env.ENV_FILE ? path.resolve(process.env.ENV_FILE) : path.join(root, '.env');
const port = process.env.API_PORT || '3001';
const args = process.argv.slice(2);
const noStart = args.includes('--no-start');
const expoArgs = args.filter((a) => a !== '--no-start');

function detectIp() {
  if (process.env.LAN_IP) return process.env.LAN_IP;
  if (process.platform === 'darwin') {
    for (const iface of ['en0', 'en1', 'en2', 'en3', 'en4', 'en5', 'en6']) {
      try {
        const ip = execFileSync('ipconfig', ['getifaddr', iface], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (ip) return ip;
      } catch {
        /* interface has no address */
      }
    }
  }
  return pickLanIp(os.networkInterfaces());
}

const ip = detectIp();
if (!ip) {
  console.error('Could not find a LAN IP. Connect to Wi-Fi/Ethernet or run: LAN_IP=<your ip> npm run dev:lan');
  process.exit(1);
}

const url = `http://${ip}:${port}`;
const before = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : '';
const previous = readEnvVar(before, 'EXPO_PUBLIC_API_URL');
fs.writeFileSync(envFile, upsertEnvVar(before, 'EXPO_PUBLIC_API_URL', url));
console.log(`EXPO_PUBLIC_API_URL: ${previous ?? '(not set)'} -> ${url}${previous === url ? ' (unchanged)' : ''}`);

try {
  const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2500) });
  console.log(res.ok ? `Backend answers on ${url}/health` : `WARNING: ${url}/health answered HTTP ${res.status}`);
} catch {
  console.warn(`WARNING: the backend does not answer on ${url}/health. Start it first (see README), and keep the phone on the same network.`);
}

if (noStart) process.exit(0);

console.log(`Starting Expo for ${ip} (Metro cache cleared)…`);
const child = spawn('npx', ['expo', 'start', '-c', ...expoArgs], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, REACT_NATIVE_PACKAGER_HOSTNAME: ip },
});
child.on('exit', (code) => process.exit(code ?? 0));
