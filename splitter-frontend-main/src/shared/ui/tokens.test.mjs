import test from "node:test";
import assert from "node:assert/strict";
import { palettes, contrastRatio, resolveScheme } from "./tokens.ts";

test("contrastRatio matches known values", () => {
  assert.equal(contrastRatio("#000000", "#FFFFFF").toFixed(1), "21.0");
  assert.equal(contrastRatio("#777777", "#FFFFFF").toFixed(2), "4.48");
  assert.equal(contrastRatio("#FFFFFF", "#FFFFFF"), 1);
});

for (const scheme of ["light", "dark"]) {
  const p = palettes[scheme];
  test(`${scheme}: text pairs meet WCAG AA (4.5:1)`, () => {
    const pairs = [
      ["text/screen", p.text, p.screen], ["text/surface", p.text, p.surface], ["text/field", p.text, p.field],
      ["textMuted/screen", p.textMuted, p.screen], ["textMuted/surface", p.textMuted, p.surface], ["textMuted/field", p.textMuted, p.field],
      ["accentText/screen", p.accentText, p.screen], ["accentText/surface", p.accentText, p.surface],
      ["danger/screen", p.danger, p.screen], ["danger/surface", p.danger, p.surface], ["danger/dangerSurface", p.danger, p.dangerSurface],
      ["onAccent/accentFill", p.onAccent, p.accentFill], ["onDanger/dangerFill", p.onDanger, p.dangerFill],
      ["text/accentSurface", p.text, p.accentSurface], ["text/dangerSurface", p.text, p.dangerSurface],
    ];
    for (const [name, fg, bg] of pairs) assert.ok(contrastRatio(fg, bg) >= 4.5, `${scheme} ${name}: ${contrastRatio(fg, bg).toFixed(2)}`);
  });
  test(`${scheme}: icons and field borders are visible enough (3:1) where they carry meaning`, () => {
    assert.ok(contrastRatio(p.accentText, p.surface) >= 3);
    assert.ok(contrastRatio(p.textMuted, p.surface) >= 3);
  });
}

test("resolveScheme: an explicit mode wins, 'system' follows the phone and defaults to light", () => {
  assert.equal(resolveScheme("dark", "light"), "dark");
  assert.equal(resolveScheme("light", "dark"), "light");
  assert.equal(resolveScheme("system", "dark"), "dark");
  assert.equal(resolveScheme("system", "light"), "light");
  assert.equal(resolveScheme("system", null), "light");
  assert.equal(resolveScheme("system", undefined), "light");
});
