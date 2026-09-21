// The parameter panel, as data.
//
// What the kernel sends for a @ui function - see inspector.ui_models() - is a
// list of parameters with a type, a default and what the decorator added. This
// module turns that into widgets, groups and the Python call that applies a
// change, and decides when the panel is on screen. It is pure so that all of it
// can be asserted under `node --test`; the DOM half is panel.js.

/** Which control a parameter gets, from its type and what the Param says. */
export function widgetFor({ type, interval = null, choice = null }) {
  if (choice !== null && choice !== undefined) {
    return "select";
  }
  if (interval !== null && interval !== undefined) {
    return "slider";
  }
  if (type === "bool") {
    return "check";
  }
  if (type === "int" || type === "float") {
    return "number";
  }
  return "text";
}

/**
 * The parameters in their groups, in order of first appearance.
 *
 * Signature order is the author's order, so a group is placed where its first
 * parameter is and the ungrouped ones keep their place under an empty name.
 */
export function groupsOf(parameters) {
  const groups = [];
  const byName = new Map();
  for (const parameter of parameters) {
    const name = parameter.group ?? "";
    let group = byName.get(name);
    if (group === undefined) {
      group = { name, parameters: [] };
      byName.set(name, group);
      groups.push(group);
    }
    group.parameters.push(parameter);
  }
  return groups;
}

/** The slider's lo and hi from a Param's interval, and its step from the Param. */
export function sliderOf({ interval, step = 1 }) {
  const [lo, hi] = interval;
  return { lo, hi, step };
}

/** How many decimals a step has: 0.25 has two, 1 has none, 1e-3 has three. */
export function decimalsOf(step) {
  const text = String(step);
  if (text.includes("e-")) {
    return Number(text.slice(text.indexOf("e-") + 2)) + decimalsOf(Number(text.slice(0, text.indexOf("e"))));
  }
  return text.includes(".") ? text.length - text.indexOf(".") - 1 : 0;
}

/**
 * A value as the field shows it.
 *
 * A float always shows a decimal point - `3.0`, never `3`, so that the field
 * says which type it is - and as many decimals as its step has when that is
 * more, so a step of 0.25 reads 3.25 and not 3.3. An int is an int.
 */
export function formatValue(value, type, step = 1) {
  if (value === null || value === undefined) {
    return "";
  }
  if (type === "float") {
    return Number(value).toFixed(Math.max(1, decimalsOf(step)));
  }
  return String(value);
}

/**
 * A value moved by one step, rounded to the step's own precision.
 *
 * Binary floating point makes 0.1 + 0.2 into 0.30000000000000004, and that is
 * what the field would show and the kernel would be sent. Rounding to as many
 * decimals as the step has keeps a click on 0.1 reading 0.3.
 */
export function stepped(value, step, direction, type) {
  const next = (value ?? 0) + direction * step;
  if (type === "int") {
    return Math.round(next);
  }
  return Number(next.toFixed(decimalsOf(step)));
}

/**
 * The text of a widget as the parameter's value, or null when it is not one.
 *
 * A number field that has been emptied, or holds half an exponent, is not a
 * value and must not reach the kernel as `count=NaN`.
 */
export function parseValue(text, type) {
  if (type === "int" || type === "float") {
    const trimmed = text.trim();
    if (trimmed === "") {
      return null;
    }
    const number = Number(trimmed);
    if (Number.isFinite(number) === false) {
      return null;
    }
    return type === "int" ? Math.trunc(number) : number;
  }
  return text;
}

/**
 * A value as Python source.
 *
 * A JSON string is a Python string: the same quotes, the same escapes for
 * everything JSON.stringify emits. Numbers are written so that a float stays a
 * float - `1.0` rather than `1` - because a model that does `length / 2` may
 * not care but one that does `isinstance(x, int)` does.
 */
export function pythonLiteral(value, type) {
  if (value === null || value === undefined) {
    return "None";
  }
  if (type === "bool") {
    return value === true ? "True" : "False";
  }
  if (type === "int") {
    return String(Math.trunc(value));
  }
  if (type === "float") {
    const text = String(value);
    return /^-?\d+$/.test(text) ? `${text}.0` : text;
  }
  return JSON.stringify(String(value));
}

/**
 * The code that applies the panel's values: the model called with every
 * parameter by keyword, and its result shown.
 *
 * Every parameter rather than only the changed ones, so the call reads as the
 * complete state of the panel and a kernel that was restarted in between still
 * gets the same picture. Not bound to a name: the script's own name for the
 * result is the script's, and the function is asked for the model, not for a
 * variable.
 */
export function callFor(fn, parameters, values) {
  const args = parameters
    .map((parameter) => `${parameter.name}=${pythonLiteral(values[parameter.name], parameter.type)}`)
    .join(", ");
  return `show(${fn}(${args}))`;
}

/** The panel's initial values: every parameter's default. */
export function defaultsOf(parameters) {
  const values = {};
  for (const parameter of parameters) {
    values[parameter.name] = parameter.default;
  }
  return values;
}

/**
 * One key for a set of model names, so that "closed for these" can be told
 * from "closed for the ones before".
 */
export function keyOf(models) {
  return Object.keys(models).sort().join("\n");
}

/**
 * Whether the panel is on screen.
 *
 * Open whenever the kernel has a model, unless the user closed it - and a
 * close holds for exactly the models it was closed on, until the next Run from
 * the editor (see panel.js's runFromEditor). The models arrive on every idle,
 * and most idles are not Runs: a line typed in the console, the panel's own
 * call. Those must not bring back what was just closed; a Run is the user
 * asking for the model again, and a different model is a new offer either way.
 */
export function isOpen({ models, dismissed }) {
  const key = keyOf(models);
  if (key === "") {
    return false;
  }
  return dismissed !== key;
}

/**
 * Where the panel goes: the remembered place, kept far enough inside the
 * viewport that its header can still be reached. A panel left at the far
 * right of a wide window must not come back off screen in a narrow one.
 */
export function placeWithin({ x, y }, { width }, viewport) {
  const minVisible = Math.min(120, width);
  const maxX = Math.max(0, viewport.width - minVisible);
  const maxY = Math.max(0, viewport.height - 32);
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(0, y), maxY),
  };
}
