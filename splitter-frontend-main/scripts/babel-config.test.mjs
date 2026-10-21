import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const babel = require("@babel/core");
const makeConfig = require("../babel.config.js");

// Only the module-resolver entry of our babel.config.js, with exactly the options we ship.
const api = { cache: () => {} };
const resolverPlugin = makeConfig(api).plugins.find((p) => Array.isArray(p) && p[0] === "module-resolver");

const transform = (code, filename) =>
  babel.transformSync(code, { filename, babelrc: false, configFile: false, plugins: [resolverPlugin] }).code;

test("module-resolver is configured", () => {
  assert.ok(resolverPlugin, "module-resolver entry missing in babel.config.js");
});

test("bare require('.') in node_modules is left alone (regression: expo-router navigationEvents crash)", () => {
  const out = transform(
    'const _1 = require("."); const x = require("./sibling"); const up = require("..");',
    `${process.cwd()}/node_modules/expo-router/build/navigationEvents/navigation.js`
  );
  assert.match(out, /require\("\."\)/, out);
  assert.match(out, /require\("\.\/sibling"\)/, out);
  assert.match(out, /require\("\.\."\)/, out);
});

test("the '@/…' alias still maps to ./src", () => {
  const out = transform('import a from "@/shared/x";', `${process.cwd()}/app/tabs/index.tsx`);
  assert.match(out, /\.\.\/\.\.\/src\/shared\/x/, out);
});
