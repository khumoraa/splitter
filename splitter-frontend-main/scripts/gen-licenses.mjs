// npm run gen:licenses - lists the app's direct dependencies with their licenses for the "Open-source licenses" screen.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const names = Object.keys(pkg.dependencies ?? {}).sort((a, b) => a.localeCompare(b));
/** some packages (e.g. Tamagui sub-packages) ship a LICENSE file but no "license" field */
function licenseFromFile(dir) {
  for (const f of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license']) {
    const file = path.join(dir, f);
    if (!fs.existsSync(file)) continue;
    const head = fs.readFileSync(file, 'utf8').slice(0, 200);
    if (/^\s*MIT License/i.test(head)) return 'MIT';
    if (/Apache License/i.test(head)) return 'Apache-2.0';
    if (/ISC License/i.test(head)) return 'ISC';
  }
  return 'UNKNOWN';
}
const out = [];
for (const name of names) {
  try {
    const p = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
    const license = typeof p.license === 'string' ? p.license : p.license?.type ?? (Array.isArray(p.licenses) ? p.licenses.map((l) => l.type).join(' OR ') : 'UNKNOWN');
    out.push({ name, version: p.version, license: license !== 'UNKNOWN' ? license : licenseFromFile(path.join(root, 'node_modules', name)) });
  } catch {
    out.push({ name, version: pkg.dependencies[name], license: 'UNKNOWN' });
  }
}
fs.writeFileSync(path.join(root, 'src/shared/config/licenses.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`${out.length} packages written to src/shared/config/licenses.json (${out.filter((x) => x.license === 'UNKNOWN').length} without a license field)`);
