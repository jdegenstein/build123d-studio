// node --test tests/unit/params/model.test.mjs
//
// The parameter panel's data half: what a parameter becomes, what a change
// sends, and when the panel is on screen.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  callFor,
  decimalsOf,
  defaultsOf,
  formatValue,
  groupsOf,
  isOpen,
  keyOf,
  parseValue,
  placeWithin,
  pythonLiteral,
  sliderOf,
  stepped,
  widgetFor,
} from "../../../src/params/model.js";

const STAND = [
  { name: "length", type: "int", default: 50, group: "Stand", desc: "Length", interval: null, choice: { large: 70, small: 30 }, step: 1 },
  { name: "radius", type: "int", default: 25, group: "Stand", desc: "", interval: null, choice: null },
  { name: "count", type: "int", default: 7, group: "Holders", desc: "How many", interval: [3, 14], choice: null },
  { name: "wanted", type: "bool", default: true, group: "", desc: "", interval: null, choice: null },
  { name: "label", type: "str", default: "a", group: "Stand", desc: "", interval: null, choice: null },
];

// --- widgets ---

test("a choice is a dropdown, an interval a slider, whatever the type", () => {
  assert.equal(widgetFor({ type: "int", choice: { a: 1 } }), "select");
  assert.equal(widgetFor({ type: "str", choice: { a: "x" } }), "select");
  assert.equal(widgetFor({ type: "float", interval: [0, 1] }), "slider");
});

test("a choice wins over an interval, because a dropdown cannot show a value outside its list", () => {
  assert.equal(widgetFor({ type: "int", interval: [0, 9], choice: { a: 1 } }), "select");
});

test("otherwise the type decides", () => {
  assert.equal(widgetFor({ type: "bool" }), "check");
  assert.equal(widgetFor({ type: "int" }), "number");
  assert.equal(widgetFor({ type: "float" }), "number");
  assert.equal(widgetFor({ type: "str" }), "text");
  assert.equal(widgetFor({ type: "Vector" }), "text");
});

test("a slider takes its ends from the interval and its step from the Param", () => {
  assert.deepEqual(sliderOf({ interval: [3, 14], step: 1 }), { lo: 3, hi: 14, step: 1 });
  assert.deepEqual(sliderOf({ interval: [0, 1], step: 0.01 }), { lo: 0, hi: 1, step: 0.01 });
  assert.deepEqual(sliderOf({ interval: [0, 10] }), { lo: 0, hi: 10, step: 1 });
});

test("a step's decimals", () => {
  assert.equal(decimalsOf(1), 0);
  assert.equal(decimalsOf(0.5), 1);
  assert.equal(decimalsOf(0.25), 2);
  assert.equal(decimalsOf(1e-3), 3);
  assert.equal(decimalsOf(2.5e-3), 4);
});

test("a float shows at least one decimal, and as many as its step has", () => {
  assert.equal(formatValue(3, "float"), "3.0");
  assert.equal(formatValue(3, "float", 1), "3.0");
  assert.equal(formatValue(3.25, "float", 0.25), "3.25");
  assert.equal(formatValue(3.25, "float", 0.5), "3.3");
  assert.equal(formatValue(3.5, "float", 0.5), "3.5");
  assert.equal(formatValue(0.1 + 0.2, "float", 0.1), "0.3");
});

test("an int shows as an int, and nothing shows as nothing", () => {
  assert.equal(formatValue(7, "int", 0.5), "7");
  assert.equal(formatValue(null, "float"), "");
  assert.equal(formatValue(undefined, "int"), "");
});

test("a step moves the value and keeps the step's precision", () => {
  assert.equal(stepped(7, 1, 1, "int"), 8);
  assert.equal(stepped(7, 1, -1, "int"), 6);
  assert.equal(stepped(7, 2.5, 1, "int"), 10);
  // 0.1 + 0.2 is 0.30000000000000004 in binary; the field must not say so.
  assert.equal(stepped(0.2, 0.1, 1, "float"), 0.3);
  assert.equal(stepped(1.0, 0.25, -1, "float"), 0.75);
  assert.equal(stepped(null, 1, 1, "float"), 1);
});

// --- groups ---

test("groups keep the order of their first parameter, and the ungrouped keep their place", () => {
  const groups = groupsOf(STAND);
  assert.deepEqual(groups.map((group) => group.name), ["Stand", "Holders", ""]);
  assert.deepEqual(groups[0].parameters.map((p) => p.name), ["length", "radius", "label"]);
  assert.deepEqual(groups[2].parameters.map((p) => p.name), ["wanted"]);
});

// --- values ---

test("a number field that is empty or unfinished is not a value", () => {
  assert.equal(parseValue("", "int"), null);
  assert.equal(parseValue("  ", "float"), null);
  assert.equal(parseValue("1e", "float"), null);
  assert.equal(parseValue("abc", "int"), null);
});

test("an int field truncates and a float field keeps the fraction", () => {
  assert.equal(parseValue("7.9", "int"), 7);
  assert.equal(parseValue("7.9", "float"), 7.9);
  assert.equal(parseValue(" 12 ", "int"), 12);
});

test("text is text, spaces included", () => {
  assert.equal(parseValue(" a b ", "str"), " a b ");
});

test("Python literals: bool, int, float and str as Python reads them", () => {
  assert.equal(pythonLiteral(true, "bool"), "True");
  assert.equal(pythonLiteral(false, "bool"), "False");
  assert.equal(pythonLiteral(7, "int"), "7");
  assert.equal(pythonLiteral(7.9, "int"), "7");
  assert.equal(pythonLiteral(2, "float"), "2.0");
  assert.equal(pythonLiteral(-3, "float"), "-3.0");
  assert.equal(pythonLiteral(2.5, "float"), "2.5");
  assert.equal(pythonLiteral("it's \"x\"\n", "str"), '"it\'s \\"x\\"\\n"');
  assert.equal(pythonLiteral(null, "int"), "None");
});

test("the call names every parameter, in signature order, and shows the result", () => {
  const values = { ...defaultsOf(STAND), count: 9, wanted: false };
  assert.equal(
    callFor("candle_stand", STAND, values),
    'show(candle_stand(length=50, radius=25, count=9, wanted=False, label="a"))',
  );
});

test("the defaults are the panel's first values", () => {
  assert.deepEqual(defaultsOf(STAND), { length: 50, radius: 25, count: 7, wanted: true, label: "a" });
});

// --- on screen or not ---

test("no model, no panel", () => {
  assert.equal(isOpen({ models: {}, dismissed: null }), false);
});

test("a model opens the panel until it is closed on that model", () => {
  const models = { stand: STAND };
  assert.equal(isOpen({ models, dismissed: null }), true);
  assert.equal(isOpen({ models, dismissed: keyOf(models) }), false);
});

test("a different model is a new offer; the same one defined again is not", () => {
  const dismissed = keyOf({ stand: STAND });
  assert.equal(isOpen({ models: { stand: STAND }, dismissed }), false);
  assert.equal(isOpen({ models: { bracket: STAND }, dismissed }), true);
  assert.equal(isOpen({ models: { stand: STAND, bracket: STAND }, dismissed }), true);
});

test("the key does not depend on the order the namespace lists the models in", () => {
  assert.equal(keyOf({ a: [], b: [] }), keyOf({ b: [], a: [] }));
});

// --- where it goes ---

test("a remembered place is kept when it fits", () => {
  const viewport = { width: 1600, height: 1000 };
  assert.deepEqual(placeWithin({ x: 300, y: 200 }, { width: 320, height: 400 }, viewport), { x: 300, y: 200 });
});

test("a place off the edge is pulled back so the header can be grabbed", () => {
  const viewport = { width: 800, height: 600 };
  const size = { width: 320, height: 400 };
  assert.deepEqual(placeWithin({ x: 1500, y: 900 }, size, viewport), { x: 680, y: 568 });
  assert.deepEqual(placeWithin({ x: -50, y: -50 }, size, viewport), { x: 0, y: 0 });
});
