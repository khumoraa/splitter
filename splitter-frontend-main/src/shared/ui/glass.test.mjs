import test from "node:test";
import assert from "node:assert/strict";
import { composite, veil, GLASS_VEIL_ALPHA } from "./glass.ts";
import { palettes, contrastRatio } from "./tokens.ts";

test("text on glass meets WCAG AA in both themes, whatever is behind the glass", () => {
  for (const scheme of ["light", "dark"]) {
    const p = palettes[scheme];
    for (const behind of ["#000000", "#FFFFFF", "#2ECC71", "#C62F34"]) {
      const bg = composite(p.surface, behind, GLASS_VEIL_ALPHA);
      assert.ok(contrastRatio(p.text, bg) >= 4.5, `${scheme} text on ${behind}: ${contrastRatio(p.text, bg).toFixed(2)}`);
      assert.ok(contrastRatio(p.textMuted, bg) >= 4.5, `${scheme} muted on ${behind}: ${contrastRatio(p.textMuted, bg).toFixed(2)}`);
      assert.ok(contrastRatio(p.accentText, bg) >= 3, `${scheme} accent on ${behind}`);
    }
  }
  assert.equal(composite("#FFFFFF", "#000000", 0.5), "#808080");
  assert.equal(veil("#1A1D1C", 0.5), "rgba(26,29,28,0.5)");
});
