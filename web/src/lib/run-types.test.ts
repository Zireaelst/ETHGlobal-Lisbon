import { strict as assert } from "node:assert";
import { test } from "node:test";
import { short } from "./run-types.js";

// The regression this file exists for: slice(-0) returns the whole string, so `tail: 0` used to
// render the truncated head followed by the ENTIRE untruncated value. It shipped to the evidence
// panel and printed every long URL twice before anyone noticed.
test("short() with no tail truncates instead of appending the whole value", () => {
  const url = "https://api.testnet.blocky402.com";
  const out = short(url, 20, 0);
  assert.equal(out, "https://api.testnet.…");
  assert.ok(!out.endsWith(url), "the full value must not reappear after the ellipsis");
});

test("short() keeps both ends when a tail is asked for", () => {
  assert.equal(short("0x1234567890abcdef1234567890abcdef", 6, 4), "0x1234…cdef");
});

test("short() leaves values that already fit untouched", () => {
  assert.equal(short("0.0.9738448", 20, 0), "0.0.9738448");
  assert.equal(short("short", 10, 6), "short");
});

test("short() renders an em dash for absent values", () => {
  assert.equal(short(null), "—");
  assert.equal(short(undefined), "—");
  assert.equal(short(""), "—");
});
