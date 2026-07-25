import { test } from "node:test";
import assert from "node:assert/strict";
import { THEME_TOKENS, rgbaCss, cssVarsFor } from "./theme-tokens";

test("rgbaCss formats an RGBA token as a CSS rgba() string", () => {
  assert.equal(rgbaCss([5, 6, 10, 1]), "rgba(5,6,10,1)");
  assert.equal(rgbaCss([232, 227, 216, 0.6]), "rgba(232,227,216,0.6)");
});

test("every token has both an open and a sealed value", () => {
  for (const [name, pair] of Object.entries(THEME_TOKENS)) {
    assert.ok(pair.open, `${name}.open is missing`);
    assert.ok(pair.sealed, `${name}.sealed is missing`);
  }
});

test("cssVarsFor returns every themed CSS custom property", () => {
  const vars = cssVarsFor("sealed");
  assert.deepEqual(Object.keys(vars).sort(), [
    "--bg",
    "--chap-alert",
    "--chap-cool",
    "--chap-warm",
    "--fill",
    "--ink",
    "--ink-soft",
    "--line",
  ]);
  assert.equal(vars["--bg"], "rgba(5,6,10,1)");
});

test("open and sealed themes produce different backgrounds", () => {
  const open = cssVarsFor("open");
  const sealed = cssVarsFor("sealed");
  assert.notEqual(open["--bg"], sealed["--bg"]);
});
