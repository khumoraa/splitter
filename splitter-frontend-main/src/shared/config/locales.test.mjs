import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dir = new URL("./locales/", import.meta.url);
const flat = (d, p = "") =>
  Object.entries(d).reduce((a, [k, v]) => (v && typeof v === "object" ? { ...a, ...flat(v, p + k + ".") } : { ...a, [p + k]: v }), {});
const load = (l) => flat(JSON.parse(fs.readFileSync(new URL(`${l}.json`, dir), "utf8")));
const en = load("en"), ja = load("ja"), uz = load("uz");

test("all languages have exactly the same keys", () => {
  for (const [name, other] of [["ja", ja], ["uz", uz]]) {
    assert.deepEqual(Object.keys(en).filter((k) => !(k in other)), [], `keys missing in ${name}`);
    assert.deepEqual(Object.keys(other).filter((k) => !(k in en)), [], `extra keys in ${name}`);
  }
});

test("no empty translations and interpolation placeholders match en", () => {
  const ph = (s) => (String(s).match(/{{\s*\w+\s*}}/g) || []).sort().join(",");
  for (const [name, loc] of [["ja", ja], ["uz", uz]]) {
    for (const [k, v] of Object.entries(loc)) {
      assert.ok(String(v).trim().length > 0, `${name}.${k} is empty`);
      assert.equal(ph(v), ph(en[k]), `${name}.${k} placeholders differ from en`);
    }
  }
});
