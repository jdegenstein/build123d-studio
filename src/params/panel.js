import * as ipc from "../ipc.js";
import { kernelState, onKernelChange } from "../kernelstate.js";
import * as log from "../log.js";
import { getSetting, setSetting } from "../store.js";
import {
  callFor,
  defaultsOf,
  formatValue,
  groupsOf,
  isOpen,
  keyOf,
  parseValue,
  placeWithin,
  sliderOf,
  stepped,
  widgetFor,
} from "./model.js";

// The parameter panel.
//
// A floating window inside the application's window: it appears when the
// kernel has a @ui-decorated function, sits wherever it was last dragged, and
// closes with its own button. Every control in it, when changed, calls the
// model with the panel's current values and shows the result - the same
// kernel.execute a Run sends, without the console coming forward, because a
// slider is not a Run and the console has nothing to say about it.
//
// The models arrive from the sidecar beside the variable rows, on every idle
// (see inspector.ui_models). What is on screen is therefore never remembered
// across a restart: a restarted kernel has no functions, and the panel goes
// with them until the next Run defines one.
//
// Floating rather than a pane, because a form of a dozen sliders has no home
// among the editor, the viewer and the console, and the one thing it needs is
// to sit beside the model it changes - which is wherever the viewer is.

const PLACE_KEY = "paramsPlace";
const ID = "params-panel";

// How long the panel waits after a change before calling the model, in
// milliseconds. Five quick clicks on a step button are one intention, not five
// rebuilds queued on the kernel with the viewer redrawing each on the way to
// the last. Two hundred is above the gap between clicks of a burst and below
// what reads as lag after a single one.
const APPLY_DELAY = 200;

// What the sidecar last said, and the values the controls hold. Values are kept
// per model function so that a second Run defining the same function again
// keeps what the user had dialled in, rather than snapping back to the
// defaults with every idle.
let models = {};
let values = new Map();
// The key of the models the user closed the panel on, or null. See isOpen.
let dismissed = null;
// Whether the next models from the kernel follow a Run from the editor. That
// Run showed the model as the script has it - the defaults - so the panel
// starts over from them; any other idle keeps what the user dialled in.
let afterRun = false;
// The name of the function whose parameters are shown when there are several.
let current = null;

let panel = null;
// Called when the panel opens or closes, so the menu can grey its toggle.
let onChange = () => {};
// The call waiting for the burst of changes to end. See APPLY_DELAY.
let pendingApply = null;
// The model whose call is waiting for the kernel to finish what it is doing.
//
// The debounce ends a burst of clicks; this ends a queue. A rebuild takes what
// it takes - a second for the candle stand, longer for a real assembly - and a
// change made while one is running would otherwise line up behind it, each
// queued call redrawing a state the user has already moved past. So while the
// kernel is busy a change is held, and the next idle sends one call with the
// values as they are then: at most one rebuild running and one waiting.
let heldForIdle = null;

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function place(position) {
  const bounds = panel.getBoundingClientRect();
  const placed = placeWithin(position, bounds, viewport());
  panel.style.left = `${placed.x}px`;
  panel.style.top = `${placed.y}px`;
  return placed;
}

function startDrag(event) {
  // Only the empty part of the header moves the panel: the close button and
  // the model selector are controls, and pressing one is not a grab.
  if (event.target.closest("button, select") !== null) {
    return;
  }
  event.preventDefault();
  const origin = { x: event.clientX, y: event.clientY };
  const from = { x: panel.offsetLeft, y: panel.offsetTop };
  let at = from;

  const onMove = (move) => {
    at = place({ x: from.x + move.clientX - origin.x, y: from.y + move.clientY - origin.y });
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    // Written once, at the end of the drag, as the explorer's column widths
    // are - a hundred writes of settings.json for one gesture is not a save.
    setSetting(PLACE_KEY, at).catch((error) => log.warn("Could not save the panel's place:", error));
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

function send(fn) {
  const parameters = models[fn];
  if (parameters === undefined) {
    return;
  }
  if (!ipc.isConnected()) {
    log.warn("Cannot apply parameters: the sidecar is not connected");
    return;
  }
  const code = callFor(fn, parameters, values.get(fn));
  log.info(`Parameters: ${code}`);
  ipc.send("kernel.execute", { code });
}

/** Call the model with the panel's values once the changes stop coming. */
function apply(fn) {
  clearTimeout(pendingApply);
  pendingApply = setTimeout(() => {
    pendingApply = null;
    if (kernelState() === "busy") {
      heldForIdle = fn;
      return;
    }
    send(fn);
  }, APPLY_DELAY);
}

function labelled(parameter) {
  const label = document.createElement("label");
  label.className = "params-label";
  // textContent throughout: a description is the script's own text and a
  // default may be any repr the kernel produced.
  label.textContent = parameter.desc === "" ? parameter.name : parameter.desc;
  label.title = parameter.name;
  return label;
}

function control(fn, parameter) {
  const held = values.get(fn);
  const value = held[parameter.name];
  const kind = widgetFor(parameter);
  const set = (next) => {
    held[parameter.name] = next;
    apply(fn);
  };

  if (kind === "check") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = value === true;
    input.addEventListener("change", () => set(input.checked));
    return input;
  }

  if (kind === "select") {
    const select = document.createElement("select");
    select.className = "params-select";
    for (const [label, option] of Object.entries(parameter.choice)) {
      const element = document.createElement("option");
      element.textContent = label;
      element.value = label;
      element.selected = option === value;
      select.appendChild(element);
    }
    select.addEventListener("change", () => set(parameter.choice[select.value]));
    return select;
  }

  if (kind === "slider") {
    const { lo, hi, step } = sliderOf(parameter);
    const row = document.createElement("span");
    row.className = "params-slider";
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(lo);
    input.max = String(hi);
    input.step = String(step);
    input.value = String(value ?? lo);
    const readout = document.createElement("span");
    readout.className = "params-readout";
    readout.textContent = formatValue(value ?? lo, parameter.type, step);
    // The readout follows the thumb; the kernel hears only the release. A
    // rebuild per pixel of a drag would queue a hundred runs behind the first.
    input.addEventListener("input", () => {
      readout.textContent = formatValue(Number(input.value), parameter.type, step);
    });
    input.addEventListener("change", () => set(parseValue(input.value, parameter.type)));
    row.append(input, readout);
    return row;
  }

  const input = document.createElement("input");
  input.className = "params-input";
  input.type = "text";
  input.value = kind === "number" ? formatValue(value, parameter.type, parameter.step ?? 1) : String(value ?? "");
  input.addEventListener("change", () => {
    const next = parseValue(input.value, parameter.type);
    if (next === null && kind === "number") {
      // Not a value: leave the field as typed and the model as it was.
      input.classList.add("params-invalid");
      return;
    }
    input.classList.remove("params-invalid");
    if (kind === "number") {
      input.value = formatValue(next, parameter.type, parameter.step ?? 1);
    }
    set(next);
  });
  if (kind !== "number") {
    return input;
  }

  // A number field, with a step up and a step down stacked beside it. The
  // browser's own spinner on type=number was not used: it is drawn differently
  // on every platform, hides until hovered on some, and its arrow keys and
  // wheel change the value without a change event a caller can rely on.
  input.inputMode = "decimal";
  const field = document.createElement("span");
  field.className = "params-number";
  const buttons = document.createElement("span");
  buttons.className = "params-steps";
  // The arrows are drawn in CSS rather than typed: a small-triangle glyph is
  // whatever the platform's fallback font makes of it, which in WKWebView was
  // a dot.
  for (const [name, direction, title] of [["up", 1, "Increase"], ["down", -1, "Decrease"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `params-step params-step-${name}`;
    button.title = `${title} by ${parameter.step ?? 1}`;
    button.setAttribute("aria-label", button.title);
    button.addEventListener("click", () => {
      // From what the field shows if that is a number, else from the value the
      // model has - a field reading "abc" steps from the last good value.
      const from = parseValue(input.value, parameter.type) ?? held[parameter.name];
      const next = stepped(from, parameter.step ?? 1, direction, parameter.type);
      input.value = formatValue(next, parameter.type, parameter.step ?? 1);
      input.classList.remove("params-invalid");
      set(next);
    });
    buttons.appendChild(button);
  }
  field.append(input, buttons);
  return field;
}

function renderBody() {
  const body = panel.querySelector(".params-body");
  body.replaceChildren();
  const parameters = models[current];
  if (parameters === undefined) {
    return;
  }
  for (const group of groupsOf(parameters)) {
    if (group.name !== "") {
      const heading = document.createElement("div");
      heading.className = "params-group";
      heading.textContent = group.name;
      body.appendChild(heading);
    }
    for (const parameter of group.parameters) {
      const row = document.createElement("div");
      row.className = "params-row";
      row.dataset.parameter = parameter.name;
      row.append(labelled(parameter), control(current, parameter));
      body.appendChild(row);
    }
  }
}

function renderHeader() {
  const select = panel.querySelector(".params-model");
  const names = Object.keys(models);
  select.replaceChildren();
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    option.selected = name === current;
    select.appendChild(option);
  }
  // One model is the ordinary case; the selector is only worth its space when
  // there is a choice to make.
  select.hidden = names.length < 2;
  panel.querySelector(".params-title").textContent = names.length < 2 ? (current ?? "") : "";
}

function render() {
  const open = isOpen({ models, dismissed });
  const was = panel.hidden === false;
  if (open === false) {
    panel.hidden = true;
    if (was) {
      onChange();
    }
    return;
  }
  if (current === null || models[current] === undefined) {
    current = Object.keys(models)[0];
  }
  renderHeader();
  renderBody();
  panel.hidden = false;
  place(getSetting(PLACE_KEY, { x: 0, y: 0 }) ?? { x: 0, y: 0 });
  if (was === false) {
    onChange();
  }
}

function build() {
  panel = document.createElement("div");
  panel.id = ID;
  panel.className = "params-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Parameters");
  panel.innerHTML = `
    <div class="params-header">
      <span class="params-title"></span>
      <select class="params-model" hidden></select>
      <button class="btn params-reset" id="params-reset" title="Reset to the script's values">R</button>
      <button class="btn" id="params-close" title="Close">
        <span class="icon icon-close"></span>
      </button>
    </div>
    <div class="params-body"></div>`;
  document.body.appendChild(panel);

  panel.querySelector(".params-header").addEventListener("pointerdown", startDrag);
  panel.querySelector("#params-close").addEventListener("click", closePanel);
  panel.querySelector("#params-reset").addEventListener("click", resetValues);
  panel.querySelector(".params-model").addEventListener("change", (event) => {
    current = event.target.value;
    render();
  });
  // Escape closes the panel from anywhere in the window - it is the one open
  // dialog that is not modal, so the key would otherwise only reach it while
  // one of its own controls had the focus. A modal in front takes the key
  // first: its Escape is its own.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || panel.hidden === true) {
      return;
    }
    const dialog = event.target.closest?.('[role="dialog"]') ?? null;
    if (dialog !== null && dialog !== panel) {
      return;
    }
    closePanel();
  });
  // A window that shrank must not leave the panel where it cannot be reached.
  window.addEventListener("resize", () => {
    if (panel.hidden === false) {
      place({ x: panel.offsetLeft, y: panel.offsetTop });
    }
  });
}

/**
 * A Run from the editor is on its way: whatever was closed may come back.
 *
 * Called by the editor before it sends the code, so the idle that follows the
 * Run reopens the panel for the model it defines. The panel's own calls and the
 * console go through the kernel too, and are not this: only the editor calls
 * it, and a closed panel stays closed through everything else.
 */
export function runFromEditor() {
  dismissed = null;
  afterRun = true;
}

/** Back to the script's values, shown and applied - like the viewer tabs' R. */
function resetValues() {
  const parameters = models[current];
  if (parameters === undefined) {
    return;
  }
  values.set(current, defaultsOf(parameters));
  renderBody();
  apply(current);
}

/** Whether the kernel has a model to show a panel for. */
export function hasModels() {
  return Object.keys(models).length > 0;
}

/** Whether the panel is on screen. */
export function isPanelOpen() {
  return panel !== null && panel.hidden === false;
}

/** Close the panel; it stays closed for these models until reopened. */
export function closePanel() {
  dismissed = keyOf(models);
  render();
}

/** Open the panel for the models the kernel has, if it has any. */
export function openPanel() {
  dismissed = null;
  render();
}

/** The View menu's toggle: away if it is showing, back if there is anything to show. */
export function toggleParamsPanel() {
  if (isPanelOpen()) {
    closePanel();
  } else {
    openPanel();
  }
}

/**
 * @param {object} [options]
 * @param {() => void} [options.onChange] called when the panel opens or closes
 */
export function initParams({ onChange: listener = () => {} } = {}) {
  onChange = listener;
  build();

  ipc.on("ui.models", (frame) => {
    const next = frame.models ?? {};
    // Held values survive the idles that are not a Run - the panel's own call
    // reports the same function again, and must not snap the controls back.
    // A Run from the editor starts over: what the viewer shows after it is the
    // script's defaults, and the panel says the same. A function that went
    // takes its values with it, and one whose parameters changed starts from
    // its new defaults - the old values may not fit.
    const kept = new Map();
    for (const [name, parameters] of Object.entries(next)) {
      const before = models[name];
      const same = before !== undefined && JSON.stringify(before) === JSON.stringify(parameters);
      kept.set(name, same && afterRun === false ? values.get(name) : defaultsOf(parameters));
    }
    afterRun = false;
    const hadModels = hasModels();
    models = next;
    values = kept;
    render();
    if (hadModels !== hasModels()) {
      onChange();
    }
  });

  onKernelChange(() => {
    if (heldForIdle === null || kernelState() !== "idle") {
      return;
    }
    const fn = heldForIdle;
    heldForIdle = null;
    send(fn);
  });

  // The functions these describe died with the kernel.
  const forget = () => {
    const hadModels = hasModels();
    models = {};
    values = new Map();
    clearTimeout(pendingApply);
    pendingApply = null;
    heldForIdle = null;
    render();
    if (hadModels) {
      onChange();
    }
  };
  ipc.on("sidecar.restarting", forget);
  ipc.on("kernel.restarting", forget);
}
