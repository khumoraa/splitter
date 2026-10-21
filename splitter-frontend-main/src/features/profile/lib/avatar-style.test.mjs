import test from "node:test";
import assert from "node:assert/strict";
import { initialsOf, avatarColorFor, AVATAR_COLORS, centerSquareCrop } from "./avatar-style.ts";
import { contrastRatio } from "../../../shared/ui/tokens.ts";

test("initials: one or two letters, any script, never empty", () => {
  assert.equal(initialsOf("Alice"), "A");
  assert.equal(initialsOf("alice smith"), "AS");
  assert.equal(initialsOf("  bob   van  der  berg "), "BB");
  assert.equal(initialsOf("Хумора Тест"), "ХТ");
  assert.equal(initialsOf("田中太郎"), "田");
  assert.equal(initialsOf("𠮷野家 x"), "𠮷X");
  for (const v of ["", "   ", null, undefined]) assert.equal(initialsOf(v), "?");
});

test("avatar colour is stable per seed and every colour is readable with white text (WCAG AA)", () => {
  assert.equal(avatarColorFor("#1234"), avatarColorFor("#1234"));
  assert.ok(new Set(["#1", "#2", "#3", "#4", "#5", "#6", "#7", "#8", "#9"].map(avatarColorFor)).size > 3);
  for (const c of AVATAR_COLORS) assert.ok(contrastRatio("#FFFFFF", c) >= 4.5, `${c}: ${contrastRatio("#FFFFFF", c).toFixed(2)}`);
  assert.ok(AVATAR_COLORS.includes(avatarColorFor(undefined)));
});

test("centerSquareCrop", () => {
  assert.deepEqual(centerSquareCrop(4000, 3000), { originX: 500, originY: 0, width: 3000, height: 3000 });
  assert.deepEqual(centerSquareCrop(3000, 4000), { originX: 0, originY: 500, width: 3000, height: 3000 });
  assert.deepEqual(centerSquareCrop(500, 500), { originX: 0, originY: 0, width: 500, height: 500 });
  assert.deepEqual(centerSquareCrop(10.7, 5.2), { originX: 2, originY: 0, width: 5, height: 5 });
});
