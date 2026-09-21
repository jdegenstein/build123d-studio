// The parameter panel: a floating window for a @ui-decorated model.
//
// It appears when the kernel reports one, is dragged by its header, remembers
// where it was put, closes with its button and stays closed for that model
// until the next Run from the editor or the View menu brings it back. Changing a control calls the model with
// every value and shows the result - a kernel.execute, like a Run, but the
// console is not brought forward for it.

import { expect, test } from "@playwright/test";

import { open } from "./app.mjs";

const STAND = [
  { name: "length", type: "int", default: 50, group: "Candle Stand", desc: "Length of candle stand", interval: null, choice: { large: 70, medium: 50, small: 30 }, step: 1 },
  { name: "radius", type: "int", default: 25, group: "Candle Stand", desc: "Radius of ring of stand", interval: null, choice: null, step: 5 },
  { name: "count", type: "int", default: 7, group: "Number of candle holders", desc: "Number of candle holders", interval: [3, 14], choice: null, step: 1 },
  { name: "center_candle", type: "bool", default: true, group: "Number of candle holders", desc: "Do you want center Candle", interval: null, choice: null, step: 1 },
  { name: "height_of_ring", type: "float", default: 4, group: "Properties of Ring", desc: "Height of ring", interval: null, choice: null, step: 0.25 },
];

const MODELS = { candle_stand: STAND };

// A buffer to Run from, for the case where a Run is what reopens the panel.
const PROJECT = "/documents/stand";
const FILES = { [`${PROJECT}/stand.py`]: "result = candle_stand()\nshow(result)\n" };
const WORKSPACE = {
  folder: PROJECT,
  tabs: [{ path: `${PROJECT}/stand.py`, caret: null }],
  active: `${PROJECT}/stand.py`,
};

/** The code of every kernel.execute the application has sent. */
function executed(sidecar) {
  return sidecar.received.filter((frame) => frame.type === "kernel.execute").map((f) => f.code);
}

const menuClick = (page, id) =>
  page.evaluate((id) => globalThis.__NEUTRALINO_STUB__.emit("mainMenuItemClicked", { id }), id);

const lastMenu = (page) =>
  page.evaluate(() => {
    const calls = globalThis.__NEUTRALINO_STUB__.calls().filter((call) => call.name === "setMainMenu");
    return calls[calls.length - 1].args[0];
  });

async function toggleState(page) {
  const menu = await lastMenu(page);
  const view = menu.find((entry) => entry.id === "menu.view");
  return view.menuItems.find((entry) => entry.id === "view.params");
}

test.describe("appearing", () => {
  test("a model from the kernel opens the panel, grouped as the decorator said", async ({ page }) => {
    const { sidecar } = await open(page);
    const panel = page.locator("#params-panel");
    await expect(panel).toBeHidden();

    sidecar.send("ui.models", { models: MODELS });
    await expect(panel).toBeVisible();
    await expect(panel.locator(".params-title")).toHaveText("candle_stand");
    await expect(panel.locator(".params-group")).toHaveText(["Candle Stand", "Number of candle holders", "Properties of Ring"]);
    // The description is the label; the name is what the row is addressed by.
    await expect(panel.locator('[data-parameter="count"] .params-label')).toHaveText("Number of candle holders");
    await expect(panel.locator('[data-parameter="length"] select')).toHaveValue("medium");
    await expect(panel.locator('[data-parameter="count"] input[type=range]')).toHaveValue("7");
    await expect(panel.locator('[data-parameter="center_candle"] input[type=checkbox]')).toBeChecked();
  });

  test("no model, no panel - and the menu entry is greyed", async ({ page }) => {
    const { sidecar } = await open(page);
    sidecar.send("ui.models", { models: MODELS });
    await expect(page.locator("#params-panel")).toBeVisible();
    // An enabled item carries no isDisabled at all - see menu.js's item().
    expect((await toggleState(page)).isDisabled).not.toBe(true);

    sidecar.send("ui.models", { models: {} });
    await expect(page.locator("#params-panel")).toBeHidden();
    expect((await toggleState(page)).isDisabled).toBe(true);
  });

  test("a kernel restart takes the panel with it", async ({ page }) => {
    const { sidecar } = await open(page);
    sidecar.send("ui.models", { models: MODELS });
    await expect(page.locator("#params-panel")).toBeVisible();
    sidecar.send("kernel.restarting");
    await expect(page.locator("#params-panel")).toBeHidden();
  });
});

test.describe("closing and reopening", () => {
  test("closed stays closed through the idles that are not a Run", async ({ page }) => {
    const { sidecar } = await open(page);
    const panel = page.locator("#params-panel");
    sidecar.send("ui.models", { models: MODELS });
    await expect(panel).toBeVisible();

    await page.click("#params-close");
    await expect(panel).toBeHidden();
    // A line typed in the console ends in an idle, and the idle carries the
    // same model again. Nothing to wait for: it must not reopen.
    sidecar.send("ui.models", { models: MODELS });
    await page.waitForTimeout(100);
    await expect(panel).toBeHidden();

    // A different model is a new offer.
    sidecar.send("ui.models", { models: { bracket: STAND } });
    await expect(panel).toBeVisible();
    await expect(panel.locator(".params-title")).toHaveText("bracket");
  });

  test("a Run from the editor brings a closed panel back", async ({ page }) => {
    const { sidecar } = await open(page, { files: FILES, settings: { workspace: WORKSPACE } });
    await expect(page.locator(".tab-active .tab-label")).toHaveText("stand.py");
    const panel = page.locator("#params-panel");
    sidecar.send("ui.models", { models: MODELS });
    await expect(panel).toBeVisible();
    await page.click("#params-close");
    await expect(panel).toBeHidden();

    await page.locator(".view-lines .view-line").first().click();
    await page.keyboard.press("Alt+Enter");
    await sidecar.waitFor("kernel.execute");
    // The idle after the Run reports the same model, and this time it opens.
    sidecar.send("ui.models", { models: MODELS });
    await expect(panel).toBeVisible();
  });

  test("Escape closes it from anywhere in the window", async ({ page }) => {
    const { sidecar } = await open(page, { files: FILES, settings: { workspace: WORKSPACE } });
    await expect(page.locator(".tab-active .tab-label")).toHaveText("stand.py");
    const panel = page.locator("#params-panel");
    sidecar.send("ui.models", { models: MODELS });
    await expect(panel).toBeVisible();

    // The focus is in the editor, not in the panel.
    await page.locator(".view-lines .view-line").first().click();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });

  test("the View menu brings it back, and takes it away", async ({ page }) => {
    const { sidecar } = await open(page);
    const panel = page.locator("#params-panel");
    sidecar.send("ui.models", { models: MODELS });
    await expect(panel).toBeVisible();
    await page.click("#params-close");
    await expect(panel).toBeHidden();

    await menuClick(page, "view.params");
    await expect(panel).toBeVisible();
    await menuClick(page, "view.params");
    await expect(panel).toBeHidden();
  });
});

test.describe("changing a value", () => {
  test("calls the model with every parameter and shows the result, without raising the console", async ({ page }) => {
    const { sidecar } = await open(page);
    sidecar.send("ui.models", { models: MODELS });
    const panel = page.locator("#params-panel");
    await expect(panel).toBeVisible();
    // Another tab is put in front first: a Run switches to the console (see
    // monaco.js's execute), and the point is that a slider is not a Run.
    await page.click('.console-tab[data-console-panel="backend"]');
    await expect(page.locator("#pane-console")).toBeHidden();

    await panel.locator('[data-parameter="length"] select').selectOption("large");
    await sidecar.waitFor("kernel.execute");
    expect(executed(sidecar)).toEqual([
      "show(candle_stand(length=70, radius=25, count=7, center_candle=True, height_of_ring=4.0))",
    ]);

    await panel.locator('[data-parameter="center_candle"] input[type=checkbox]').uncheck();
    await expect.poll(() => executed(sidecar).length).toBe(2);
    expect(executed(sidecar)[1]).toBe("show(candle_stand(length=70, radius=25, count=7, center_candle=False, height_of_ring=4.0))");

    await expect(page.locator("#pane-console")).toBeHidden();
    await expect(page.locator("#pane-backend")).toBeVisible();
  });

  test("a number that is not one is refused rather than sent", async ({ page }) => {
    const { sidecar } = await open(page);
    sidecar.send("ui.models", { models: MODELS });
    const field = page.locator('#params-panel [data-parameter="radius"] input');
    await expect(field).toBeVisible();

    await field.fill("abc");
    await field.press("Enter");
    await expect(field).toHaveClass(/params-invalid/);
    await page.waitForTimeout(100);
    expect(executed(sidecar)).toEqual([]);

    await field.fill("30");
    await field.press("Enter");
    await sidecar.waitFor("kernel.execute");
    await expect(field).not.toHaveClass(/params-invalid/);
    expect(executed(sidecar)).toEqual(["show(candle_stand(length=50, radius=30, count=7, center_candle=True, height_of_ring=4.0))"]);
  });

  test("the stacked buttons step a number by the Param's step", async ({ page }) => {
    const { sidecar } = await open(page);
    sidecar.send("ui.models", { models: MODELS });
    const row = page.locator('#params-panel [data-parameter="radius"]');
    await expect(row.locator("input")).toHaveValue("25");

    // radius carries step=5.
    await row.locator(".params-step").first().click();
    await sidecar.waitFor("kernel.execute");
    expect(executed(sidecar)[0]).toBe("show(candle_stand(length=50, radius=30, count=7, center_candle=True, height_of_ring=4.0))");
    await expect(row.locator("input")).toHaveValue("30");

    // Two quick clicks are one call: the kernel hears the burst's end, not
    // every click of it.
    await row.locator(".params-step").last().click();
    await row.locator(".params-step").last().click();
    await expect.poll(() => executed(sidecar).length).toBe(2);
    expect(executed(sidecar)[1]).toBe("show(candle_stand(length=50, radius=20, count=7, center_candle=True, height_of_ring=4.0))");
    await page.waitForTimeout(400);
    expect(executed(sidecar)).toHaveLength(2);

    // A field that does not hold a number steps from the value the model has.
    await row.locator("input").fill("abc");
    await row.locator("input").press("Enter");
    await expect(row.locator("input")).toHaveClass(/params-invalid/);
    await row.locator(".params-step").first().click();
    await expect(row.locator("input")).toHaveValue("25");
    await expect(row.locator("input")).not.toHaveClass(/params-invalid/);
  });

  test("changes made while the kernel is busy are sent once, when it is idle again", async ({ page }) => {
    const { sidecar } = await open(page);
    sidecar.send("ui.models", { models: MODELS });
    const panel = page.locator("#params-panel");
    const radius = panel.locator('[data-parameter="radius"]');
    await expect(radius).toBeVisible();

    // The kernel is on a rebuild. Two changes arrive while it is.
    sidecar.send("kernel.status", { state: "busy", queued: 0 });
    await radius.locator(".params-step").first().click();
    await page.waitForTimeout(400);
    await panel.locator('[data-parameter="center_candle"] input[type=checkbox]').uncheck();
    await page.waitForTimeout(400);
    expect(executed(sidecar)).toEqual([]);

    // It finishes: one call, with both changes in it.
    sidecar.send("kernel.status", { state: "idle", queued: 0 });
    await sidecar.waitFor("kernel.execute");
    expect(executed(sidecar)).toEqual([
      "show(candle_stand(length=50, radius=30, count=7, center_candle=False, height_of_ring=4.0))",
    ]);
  });

  test("a float shows a decimal point, and its step's decimals", async ({ page }) => {
    const { sidecar } = await open(page);
    sidecar.send("ui.models", { models: MODELS });
    const row = page.locator('#params-panel [data-parameter="height_of_ring"]');
    await expect(row.locator("input")).toHaveValue("4.00");

    await row.locator(".params-step").first().click();
    await sidecar.waitFor("kernel.execute");
    await expect(row.locator("input")).toHaveValue("4.25");
    expect(executed(sidecar)[0]).toContain("height_of_ring=4.25)");

    // Typed without decimals, shown with them.
    await row.locator("input").fill("5");
    await row.locator("input").press("Enter");
    await expect(row.locator("input")).toHaveValue("5.00");
  });

  test("R puts every value back to the script's and shows the result", async ({ page }) => {
    const { sidecar } = await open(page);
    sidecar.send("ui.models", { models: MODELS });
    const panel = page.locator("#params-panel");
    await panel.locator('[data-parameter="length"] select').selectOption("large");
    await sidecar.waitFor("kernel.execute");
    await panel.locator('[data-parameter="center_candle"] input[type=checkbox]').uncheck();
    await expect.poll(() => executed(sidecar).length).toBe(2);

    await page.click("#params-reset");
    await expect.poll(() => executed(sidecar).length).toBe(3);
    expect(executed(sidecar)[2]).toBe("show(candle_stand(length=50, radius=25, count=7, center_candle=True, height_of_ring=4.0))");
    await expect(panel.locator('[data-parameter="length"] select')).toHaveValue("medium");
    await expect(panel.locator('[data-parameter="center_candle"] input[type=checkbox]')).toBeChecked();
  });

  test("values dialled in survive the panel's own call, and a Run from the editor resets them", async ({ page }) => {
    const { sidecar } = await open(page, { files: FILES, settings: { workspace: WORKSPACE } });
    await expect(page.locator(".tab-active .tab-label")).toHaveText("stand.py");
    sidecar.send("ui.models", { models: MODELS });
    const panel = page.locator("#params-panel");
    const length = panel.locator('[data-parameter="length"] select');
    await length.selectOption("large");
    await sidecar.waitFor("kernel.execute");

    // The idle after the panel's call reports the same function again.
    sidecar.send("ui.models", { models: MODELS });
    await expect(length).toHaveValue("large");

    // A Run from the editor showed the script's defaults; so does the panel.
    await page.locator(".view-lines .view-line").first().click();
    await page.keyboard.press("Alt+Enter");
    await expect.poll(() => executed(sidecar).length).toBe(2);
    sidecar.send("ui.models", { models: MODELS });
    await expect(length).toHaveValue("medium");
  });
});

test.describe("dragging", () => {
  test("the header moves the panel, and the place is remembered", async ({ page }) => {
    const { sidecar } = await open(page);
    sidecar.send("ui.models", { models: MODELS });
    const panel = page.locator("#params-panel");
    await expect(panel).toBeVisible();
    const before = await panel.boundingBox();

    const header = panel.locator(".params-header");
    const box = await header.boundingBox();
    // Grab the empty part of the header, left of the close button.
    await page.mouse.move(box.x + 60, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 260, box.y + 150 + box.height / 2, { steps: 5 });
    await page.mouse.up();

    const after = await panel.boundingBox();
    expect(Math.round(after.x - before.x)).toBe(200);
    expect(Math.round(after.y - before.y)).toBe(150);

    await expect
      .poll(() =>
        page.evaluate(() => {
          const writes = globalThis.__NEUTRALINO_STUB__
            .calls()
            .filter((call) => call.name === "writeFile" && call.args[0].endsWith("settings.json"));
          if (writes.length === 0) {
            return null;
          }
          return JSON.parse(writes[writes.length - 1].args[1]).paramsPlace ?? null;
        }),
      )
      .toEqual({ x: Math.round(after.x), y: Math.round(after.y) });
  });

  test("a remembered place off the edge of a smaller window is pulled back on screen", async ({ page }) => {
    const { sidecar } = await open(page, { settings: { paramsPlace: { x: 5000, y: 5000 } } });
    sidecar.send("ui.models", { models: MODELS });
    const panel = page.locator("#params-panel");
    await expect(panel).toBeVisible();
    const box = await panel.boundingBox();
    const size = page.viewportSize();
    expect(box.x).toBeLessThanOrEqual(size.width - 120);
    expect(box.y).toBeLessThanOrEqual(size.height - 32);
  });
});
