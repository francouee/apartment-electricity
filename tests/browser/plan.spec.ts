import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { parsePoints } from "../../src/lib/csv";
import { savePositionsSchema, type PositionChange } from "../../src/lib/model";
import { unzipSync, strFromU8 } from "fflate";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

test.beforeEach(async ({ page }) => {
  const points = parsePoints(readFileSync(new URL("../../src/data/prises.csv", import.meta.url), "utf8"));
  await page.route("**/api/prises", (route) => route.fulfill({
    json: { source: "csv", updatedAt: new Date().toISOString(), points },
  }));
});

test("real entries, placement, hover linking, local persistence and CSV export", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Export Notion fourni · données locales")).toBeVisible();
  await expect(page.locator(".list-panel tbody tr")).toHaveCount(32);
  await expect(page.locator("[data-marker]")).toHaveCount(0);
  await page.getByRole("button", { name: "Prise chevet gauche Prise basse", exact: true }).click();
  await page.getByLabel("X (%)").fill("12.5");
  await page.getByLabel("Y (%)").fill("65");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  const marker = page.locator("[data-marker]");
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveAttribute("transform", "translate(250, 1300)");

  // Remove the persistent selection so highlighting must come from hover.
  await page.getByRole("button", { name: "Prise chevet droit Prise basse", exact: true }).click();
  await marker.hover();
  await expect(page.locator("tbody tr.hovered")).toContainText("Prise chevet gauche");
  await expect(page.locator(".detail-title")).toContainText("Prise chevet gauche");
  await page.getByRole("heading", { name: "Le plan électrique" }).hover();
  await expect(page.locator(".detail-title")).toContainText("Prise chevet droit");
  await page.getByRole("button", { name: "Prise chevet gauche Prise basse", exact: true }).hover();
  await expect(marker.locator("circle").first()).toHaveClass(/active/);
  await marker.focus();
  await page.keyboard.press("Enter");
  await expect(marker).toHaveAttribute("aria-pressed", "true");

  await page.reload();
  await expect(page.locator("[data-marker]")).toHaveCount(1);
  await page.getByRole("searchbox").fill("Machine");
  await expect(page.locator(".list-panel tbody tr")).toHaveCount(1);
  await expect(page.locator("[data-marker]")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter les positions" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("prises-electricite-positions.csv");
  const stream = await file.createReadStream();
  if (!stream) throw new Error("CSV download unavailable");
  let csv = "";
  for await (const part of stream) csv += part.toString();
  expect(csv).toContain('"Prise chevet gauche","Prise basse"');
  expect(csv).toContain('"12.5","65"');
  expect(csv).toContain("Prise lave-vaisselle");
});

test("placement by click remains accurate after zoom; mobile has no page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Prise chevet gauche Prise basse", exact: true }).click();
  await page.getByRole("button", { name: "Zoomer", exact: true }).click();
  await page.getByRole("button", { name: "Placer sur le plan", exact: true }).click();
  const svg = page.locator(".plan-stage svg");
  await svg.evaluate((element) => {
    element.addEventListener("click", (event) => {
      const mouse = event as MouseEvent;
      const matrix = element.querySelector("g")?.getScreenCTM();
      if (!matrix) throw new Error("Missing plan transform");
      const pointer = (element as SVGSVGElement).createSVGPoint();
      pointer.x = mouse.clientX;
      pointer.y = mouse.clientY;
      // Saving changes the notice and may scroll the page; compare in plan space.
      const position = pointer.matrixTransform(matrix.inverse());
      element.setAttribute("data-click-x", String(position.x));
      element.setAttribute("data-click-y", String(position.y));
    }, { once: true });
  });
  await svg.click({ position: { x: 140, y: 160 } });
  await expect(page.locator("[data-marker]")).toHaveCount(1);
  const alignment = await page.locator("[data-marker]").evaluate((element) => {
    const marker = element as SVGGElement;
    const matrix = marker.transform.baseVal.consolidate()?.matrix;
    if (!matrix) throw new Error("Missing SVG transform");
    return {
      x: matrix.e, y: matrix.f,
      expectedX: Number(marker.ownerSVGElement?.getAttribute("data-click-x")),
      expectedY: Number(marker.ownerSVGElement?.getAttribute("data-click-y")),
    };
  });
  expect(alignment.x).toBeCloseTo(alignment.expectedX, 4);
  expect(alignment.y).toBeCloseTo(alignment.expectedY, 4);
  const markerSize = await page.locator(".marker").evaluate((element) => element.getBoundingClientRect().width);
  expect(markerSize).toBeCloseTo(16, 0);
  const hitAreaSize = await page.locator("[data-marker] circle").last().evaluate((element) => element.getBoundingClientRect().width);
  expect(hitAreaSize).toBeCloseTo(20, 0);
  const center = await page.locator("[data-marker]").evaluate((element) => {
    const matrix = (element as SVGGElement).getScreenCTM();
    if (!matrix) throw new Error("Missing marker transform");
    return { x: matrix.e, y: matrix.f };
  });
  await page.mouse.move(center.x + 11, center.y);
  await expect(page.locator("tbody tr.hovered")).toHaveCount(0);
  await page.mouse.move(center.x + 9, center.y);
  await expect(page.locator("tbody tr.hovered")).toContainText("Prise chevet gauche");
  const statusSize = await page.locator(".status-dot").evaluate((element) => element.getBoundingClientRect().width);
  expect(statusSize).toBe(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("failed refresh shows an error without replacing real data with a fallback", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".list-panel tbody tr")).toHaveCount(32);
  await page.route("**/api/prises", (route) => route.fulfill({ status: 502, body: '{"error":"Notion unavailable"}' }));
  await page.getByRole("button", { name: "Actualiser" }).click();
  await expect(page.getByRole("alert")).toContainText("HTTP 502");
  await expect(page.locator(".list-panel tbody tr")).toHaveCount(32);
});

async function mockNotionSaving(page: Page, partial = false, writable = true) {
  const points = parsePoints(readFileSync(new URL("../../src/data/prises.csv", import.meta.url), "utf8"))
    .map((point, index) => ({ ...point, id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}` }));
  const requests: PositionChange[][] = [];
  await page.route("**/api/prises", async (route) => {
    if (route.request().method() === "POST") {
      const { changes } = savePositionsSchema.parse(route.request().postDataJSON());
      requests.push(changes);
      const saved = (partial ? changes.slice(0, 1) : changes).map(({ id, position }) => ({ id, position }));
      for (const item of saved) {
        const point = points.find((point) => point.id === item.id);
        if (point) point.position = item.position;
      }
      await route.fulfill({
        status: partial ? 502 : 200,
        json: { saved, ...(partial ? { error: "Notion refuse l'écriture de la deuxième prise." } : {}) },
      });
    } else {
      await route.fulfill({ json: { source: "notion", updatedAt: new Date().toISOString(), points, canSavePositions: writable } });
    }
  });
  return { requests, points };
}

async function placeLocally(page: Page, name: string, x = "12.5") {
  await page.getByRole("button", { name: `${name} Prise basse`, exact: true }).click();
  await page.getByLabel("X (%)").fill(x);
  await page.getByLabel("Y (%)").fill("65");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
}

test("Notion writes only after explicit confirmation, including filtered-out positions", async ({ page }) => {
  const { requests, points } = await mockNotionSaving(page);
  await page.goto("/");
  await placeLocally(page, "Prise chevet gauche");
  expect(requests).toHaveLength(0);
  await page.getByRole("searchbox").fill("Machine");
  await page.getByRole("button", { name: "Enregistrer dans Notion (1)", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Prise chevet gauche");
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "Enregistrer dans Notion (1)", exact: true }).click();
  await page.getByRole("button", { name: "Confirmer la sauvegarde" }).click();
  await expect(page.getByRole("status")).toContainText("1 position enregistrée dans Notion");
  expect(requests).toEqual([[{
    id: points[0].id, position: { x: 12.5, y: 65 }, expectedPosition: null,
  }]]);
  await expect(page.getByRole("button", { name: "Enregistrer dans Notion", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("tonduti:positions:v1") ?? "{}"))).toEqual({});
  await page.reload();
  await expect(page.locator("[data-marker]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Enregistrer dans Notion", exact: true })).toBeDisabled();
});

test("partial save keeps unsaved placements locally and reports the exact confirmed count", async ({ page }) => {
  const { points } = await mockNotionSaving(page, true);
  await page.goto("/");
  await placeLocally(page, "Prise chevet gauche");
  await placeLocally(page, "Prise chevet droit", "18");
  await page.getByRole("button", { name: "Enregistrer dans Notion (2)", exact: true }).click();
  await page.getByRole("button", { name: "Confirmer la sauvegarde" }).click();
  await expect(page.getByRole("alert")).toContainText("1 / 2 positions confirmées");
  await expect(page.getByRole("button", { name: "Enregistrer dans Notion (1)", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("tonduti:positions:v1") ?? "{}")))
    .toEqual({ [points[1].id]: { x: 18, y: 65 } });
  await page.reload();
  await expect(page.locator("[data-marker]")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Enregistrer dans Notion (1)", exact: true })).toBeEnabled();
});

test("read-only mode does not enable the save action even with local changes", async ({ page }) => {
  const { requests } = await mockNotionSaving(page, false, false);
  await page.goto("/");
  await placeLocally(page, "Prise chevet gauche");
  await expect(page.getByRole("button", { name: "Enregistrer dans Notion (1)", exact: true })).toBeDisabled();
  expect(requests).toHaveLength(0);
});

test("dragging from the list places a point locally and dragging a marker respects zoom and pan", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { requests } = await mockNotionSaving(page);
  await page.goto("/");
  const handle = page.getByRole("button", { name: "Glisser Prise chevet gauche sur le plan", exact: true });
  await handle.scrollIntoViewIfNeeded();
  const source = await handle.boundingBox();
  const plan = await page.locator(".plan-stage svg").boundingBox();
  if (!source || !plan) throw new Error("Missing drag source or plan");
  const target = { x: plan.x + plan.width * .3, y: plan.y + plan.height * .7 };
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await expect(page.locator("[data-marker]")).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem("tonduti:positions:v1"))).toBeNull();
  await page.mouse.up();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("tonduti:positions:v1") ?? "{}"));
  expect(Object.values(stored)).toHaveLength(1);
  expect(requests).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Enregistrer dans Notion (1)", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Zoomer", exact: true }).click();
  const svg = page.locator(".plan-stage svg");
  const zoomedBounds = await svg.boundingBox();
  if (!zoomedBounds) throw new Error("Missing zoomed plan");
  await page.mouse.move(zoomedBounds.x + 35, zoomedBounds.y + 30);
  await page.mouse.down();
  await page.mouse.move(zoomedBounds.x + 65, zoomedBounds.y + 50, { steps: 4 });
  await page.mouse.up();
  const transform = await page.locator(".plan-stage > svg > g").getAttribute("transform");
  const center = await page.locator("[data-marker]").evaluate((element) => {
    const matrix = (element as SVGGElement).getScreenCTM();
    if (!matrix) throw new Error("Missing marker transform");
    return { x: matrix.e, y: matrix.f };
  });
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 55, center.y - 30, { steps: 8 });
  await page.mouse.up();
  const after = await page.locator("[data-marker]").evaluate((element) => {
    const matrix = (element as SVGGElement).getScreenCTM();
    if (!matrix) throw new Error("Missing marker transform");
    return { x: matrix.e, y: matrix.f };
  });
  expect(after.x).toBeCloseTo(center.x + 55, 0);
  expect(after.y).toBeCloseTo(center.y - 30, 0);
  expect(await page.locator(".plan-stage > svg > g").getAttribute("transform")).toBe(transform);
  expect(requests).toHaveLength(0);
  await page.reload();
  await expect(page.locator("[data-marker]")).toHaveCount(1);
});

test("an outside drop, Escape or pointer cancellation preserves the prior placement", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await placeLocally(page, "Prise chevet gauche");
  const marker = page.locator("[data-marker]");
  const original = await marker.getAttribute("transform");
  const center = await marker.evaluate((element) => {
    const matrix = (element as SVGGElement).getScreenCTM();
    if (!matrix) throw new Error("Missing marker transform");
    return { x: matrix.e, y: matrix.f };
  });
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(5, 5, { steps: 10 });
  await page.mouse.up();
  await expect(marker).toHaveAttribute("transform", original!);
  await expect(page.getByRole("status")).toContainText("Déplacement annulé");
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 40, center.y - 20, { steps: 4 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(marker).toHaveAttribute("transform", original!);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 40, center.y - 20, { steps: 4 });
  await marker.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  await expect(marker).toHaveAttribute("transform", original!);
});

test("the drag handle is usable without dragging through the keyboard placement alternative", async ({ page }) => {
  await page.goto("/");
  const handle = page.getByRole("button", { name: "Glisser Prise chevet gauche sur le plan", exact: true });
  await handle.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Annuler le placement", exact: true })).toBeVisible();
  await page.getByLabel("X (%)").fill("12.5");
  await page.getByLabel("Y (%)").fill("65");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.locator("[data-marker]")).toHaveCount(1);
});

test("touch dragging from the list scrolls back to the plan on a narrow screen", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const handle = page.getByRole("button", { name: "Glisser Prise chevet gauche sur le plan", exact: true });
  await handle.scrollIntoViewIfNeeded();
  const bounds = await handle.boundingBox();
  if (!bounds) throw new Error("Missing touch handle");
  const session = await context.newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart", touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }],
  });
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 140, y: 35 }] });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const plan = await page.locator(".plan-stage svg").boundingBox();
  if (!plan) throw new Error("Missing touch plan");
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove", touchPoints: [{ x: plan.x + plan.width * .5, y: plan.y + plan.height * .65 }],
  });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page.locator("[data-marker]")).toHaveCount(1);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("tonduti:positions:v1") ?? "{}"));
  expect(Object.keys(stored)).toHaveLength(1);
  await session.detach();
});

test("artisan preview is read-only, keeps local placements and returns to admin without losing them", async ({ page }) => {
  const { requests } = await mockNotionSaving(page);
  await page.goto("/");
  await placeLocally(page, "Prise chevet gauche");
  await page.getByRole("button", { name: "Aperçu du site", exact: true }).click();
  await expect(page.getByText("Plan d’implantation", { exact: true })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/vue artisan|lecture seule/i);
  await expect(page.locator("[data-marker]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Enregistrer dans Notion/ })).toHaveCount(0);
  await expect(page.locator(".drag-handle")).toHaveCount(0);
  await page.locator("[data-marker]").click();
  await expect(page.locator(".detail-title")).toContainText("Prise chevet gauche");
  await expect(page.locator(".position-editor")).toHaveCount(0);
  const marker = page.locator("[data-marker]");
  const initial = await marker.getAttribute("transform");
  await marker.hover();
  await page.mouse.down();
  await page.mouse.move(300, 400, { steps: 5 });
  await page.mouse.up();
  await expect(marker).toHaveAttribute("transform", initial!);
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: "Retour au mode admin" }).click();
  await expect(page.locator(".drag-handle")).toHaveCount(32);
  await expect(page.locator("[data-marker]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Enregistrer dans Notion (1)", exact: true })).toBeEnabled();
});

test("ZIP export runs offline and below a GitHub Pages project path without APIs or external assets", async ({ page, context }, testInfo) => {
  await page.goto("/");
  await placeLocally(page, "Prise chevet gauche");
  await page.getByRole("searchbox").fill("Machine");
  await page.getByRole("button", { name: "Exporter pour GitHub Pages" }).click();
  await expect(page.getByRole("dialog")).toContainText("32 entrées");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Télécharger l’archive" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("plan-electricite-artisan.zip");
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Missing ZIP download");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const archive = unzipSync(Buffer.concat(chunks));
  expect(Object.keys(archive).sort()).toEqual([".nojekyll", "LISEZ-MOI.txt", "index.html"]);
  const html = strFromU8(archive["index.html"]);
  expect(html).not.toContain("NOTION_TOKEN");
  expect(html).not.toContain("app.notion.com");
  expect(html).toContain("data:image/jpeg;base64,");
  const file = testInfo.outputPath("artisan", "index.html");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
  const viewer = await context.newPage();
  const errors: string[] = [];
  const requests: string[] = [];
  viewer.on("pageerror", (error) => errors.push(error.message));
  viewer.on("request", (request) => requests.push(request.url()));
  await viewer.goto(pathToFileURL(file).href);
  await expect(viewer).toHaveTitle("Plan électrique");
  await expect(viewer.locator("main")).not.toContainText(/vue artisan|lecture seule/i);
  await expect(viewer.locator(".list-panel tbody tr")).toHaveCount(32);
  await expect(viewer.getByRole("heading", { name: "Prix par pièce" })).toBeVisible();
  await expect(viewer.locator("[data-marker]")).toHaveCount(1);
  await viewer.locator("[data-marker]").hover();
  await expect(viewer.locator("tbody tr.hovered")).toContainText("Prise chevet gauche");
  await expect(viewer.getByRole("button", { name: /Enregistrer|Exporter|Actualiser|Glisser/ })).toHaveCount(0);
  expect(requests.filter((url) => /^https?:/.test(url))).toEqual([]);
  await viewer.route("https://artisan.example/**", (route) => route.request().url() === "https://artisan.example/mon-plan/"
    ? route.fulfill({ contentType: "text/html", body: html }) : route.abort());
  requests.length = 0;
  await viewer.goto("https://artisan.example/mon-plan/");
  await expect(viewer.locator(".list-panel tbody tr")).toHaveCount(32);
  await expect(viewer.locator("[data-marker]")).toHaveCount(1);
  await viewer.getByRole("button", { name: "Zoomer", exact: true }).click();
  await viewer.getByRole("searchbox").fill("Machine");
  await expect(viewer.locator(".list-panel tbody tr")).toHaveCount(1);
  expect(requests).toEqual(["https://artisan.example/mon-plan/"]);
  expect(errors).toEqual([]);
  await viewer.setViewportSize({ width: 390, height: 844 });
  expect(await viewer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await viewer.close();
});

test("cost summary shows room subtotals, excludes missing prices and remains global through filtering and artisan preview", async ({ page }) => {
  const points = parsePoints(readFileSync(new URL("../../src/data/prises.csv", import.meta.url), "utf8"))
    .map((point, index) => ({ ...point, price: index === 0 ? 13.19 : index === 1 ? 14.67 : null }));
  await page.route("**/api/prises", (route) => route.fulfill({
    json: { source: "csv", updatedAt: new Date().toISOString(), points },
  }));
  await page.goto("/");
  const summary = page.getByRole("region", { name: "Prix par pièce" });
  await expect(summary.locator(".cost-total strong")).toHaveText(/27,86\s*€/);
  await expect(summary.locator(".cost-total span")).toHaveText("Total connu (partiel)");
  await expect(summary.getByRole("row", { name: /^Chambre / })).toContainText(/27,86\s*€/);
  await expect(summary.getByRole("row", { name: /^SDB / })).toContainText("Non renseigné");
  await expect(summary.locator(".cost-note")).toContainText("30 équipements sans prix");
  await page.getByRole("searchbox").fill("Machine");
  await expect(page.locator(".list-panel tbody tr")).toHaveCount(1);
  await expect(summary.locator(".cost-total strong")).toHaveText(/27,86\s*€/);
  await page.getByRole("button", { name: "Aperçu du site", exact: true }).click();
  await expect(page.locator(".cost-total strong")).toHaveText(/27,86\s*€/);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
