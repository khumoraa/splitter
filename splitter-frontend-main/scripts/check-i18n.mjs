#!/usr/bin/env node
/**
 * npm run check:i18n
 * Finds every translation key the code uses and checks it exists in en, ja and uz.
 *  - literal calls:       t('a.b'), t("a.b", 'default'), i18n.t('a.b')
 *  - keys kept in data:   any quoted 'a.b.c' whose first segment is a top-level locale section
 *                         (zod messages, error-key tables, ...)
 * Plural forms: 'x' is satisfied by x_one / x_other / x_zero / x_few / x_many / x_two.
 * Dynamic keys (t(`a.${b}`)) cannot be checked statically and are only counted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = ['en', 'ja', 'uz'];
const PLURAL = ['', '_one', '_other', '_zero', '_few', '_many', '_two'];

const flat = (obj, prefix = '') =>
  Object.entries(obj).reduce((acc, [k, v]) => (v && typeof v === 'object' ? { ...acc, ...flat(v, `${prefix}${k}.`) } : { ...acc, [`${prefix}${k}`]: v }), {});

export function loadLocales(base = root) {
  const out = {};
  for (const l of LANGS) out[l] = flat(JSON.parse(fs.readFileSync(path.join(base, 'src/shared/config/locales', `${l}.json`), 'utf8')));
  return out;
}

function* sourceFiles(dir) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (name.name === 'node_modules' || name.name.startsWith('.')) continue;
    const p = path.join(dir, name.name);
    if (name.isDirectory()) yield* sourceFiles(p);
    else if (/\.(ts|tsx)$/.test(name.name) && !/\.d\.ts$/.test(name.name)) yield p;
  }
}

export function collectUsedKeys(base = root, sections = new Set()) {
  const used = new Map(); // key -> Set(files)
  let dynamic = 0;
  const add = (key, file) => {
    if (!used.has(key)) used.set(key, new Set());
    used.get(key).add(path.relative(base, file));
  };
  const callRe = /\b(?:i18n\.)?t\(\s*(['"`])([A-Za-z0-9_.]+)\1/g;
  const dynRe = /\b(?:i18n\.)?t\(\s*`[^`]*\$\{/g;
  const literalRe = /(['"])([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9_]+)+)\1/g;
  for (const dir of ['app', 'src']) {
    if (!fs.existsSync(path.join(base, dir))) continue;
    for (const file of sourceFiles(path.join(base, dir))) {
      const src = fs.readFileSync(file, 'utf8');
      let m;
      while ((m = callRe.exec(src))) add(m[2], file);
      while ((m = literalRe.exec(src))) if (sections.has(m[2].split('.')[0])) add(m[2], file);
      dynamic += (src.match(dynRe) || []).length;
    }
  }
  return { used, dynamic };
}

const has = (locale, key) => PLURAL.some((s) => `${key}${s}` in locale);

export function findProblems(base = root) {
  const locales = loadLocales(base);
  const sections = new Set(Object.keys(locales.en).map((k) => k.split('.')[0]));
  const { used, dynamic } = collectUsedKeys(base, sections);
  const missing = []; // {lang, key, files}
  for (const [key, files] of used) {
    for (const lang of LANGS) if (!has(locales[lang], key)) missing.push({ lang, key, files: [...files] });
  }
  const parity = [];
  for (const a of LANGS) for (const b of LANGS) {
    if (a === b) continue;
    for (const k of Object.keys(locales[a])) if (!(k in locales[b])) parity.push({ key: k, presentIn: a, missingIn: b });
  }
  return { usedCount: used.size, dynamic, missing, parity };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = findProblems();
  console.log(`translation keys used in code: ${r.usedCount} (+ ${r.dynamic} dynamic, not checkable)`);
  for (const m of r.missing) console.log(`MISSING in ${m.lang}: ${m.key}   <- ${m.files.slice(0, 2).join(', ')}`);
  for (const p of r.parity) console.log(`PARITY: ${p.key} is in ${p.presentIn} but not in ${p.missingIn}`);
  if (r.missing.length || r.parity.length) {
    console.error(`\n${r.missing.length} missing, ${r.parity.length} parity problems`);
    process.exit(1);
  }
  console.log('OK: every used key exists in en, ja and uz; the three files have identical keys.');
}
