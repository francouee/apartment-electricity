import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
import { parsePoints } from "../../src/lib/csv";

const src = "https://assets.legrand.com/product.png";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6sX8AAAAASUVORK5CYII=";
const points = parsePoints(readFileSync(new URL("../../src/data/prises.csv", import.meta.url), "utf8"))
  .map((point, index) => ({
    ...point, position: index === 0 ? { x: 12, y: 64 } : null,
    price: index === 0 ? 13.19 : index === 1 ? 14.67 : null,
    productImages: index < 2 ? [{ name: "Double prise Legrand", src }] : [],
  }));

test.beforeEach(async ({ page }) => {
  await page.route("**/api/prises", route => route.fulfill({
    json: { source: "notion", updatedAt: new Date().toISOString(), points },
  }));
  await page.route(src, route => route.fulfill({ contentType: "image/png", body: Buffer.from(png, "base64") }));
});

test("clicking a marker or room price line shows the product photo; room details retain all entries through filtering", async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-marker]").click();
  await expect(page.locator(".detail-panel img")).toHaveAttribute("src", src);
  await expect(page.locator(".detail-panel img")).toHaveJSProperty("naturalWidth", 1);
  const roomTable = page.getByRole("table", { name: "Détail des prises et interrupteurs : Chambre", exact: true });
  await expect(roomTable.locator("tbody tr")).toHaveCount(points.filter(point => point.zone === "Chambre").length);
  await expect(roomTable.locator("img")).toHaveCount(2);
  await expect(page.locator(".cost-total strong")).toHaveText(/27,86/);
  await page.getByRole("searchbox").fill("Machine");
  await expect(page.locator(".list-panel tbody tr")).toHaveCount(1);
  await expect(roomTable.locator("tbody tr")).toHaveCount(points.filter(point => point.zone === "Chambre").length);
  await page.getByRole("button", { name: `Voir ${points[1].name}`, exact: true }).click();
  await expect(page.locator(".detail-title")).toContainText(points[1].name);
  await expect(page.locator(".detail-panel img")).toHaveJSProperty("naturalWidth", 1);
  await page.getByRole("button", { name: `Voir ${points[2].name}`, exact: true }).click();
  await expect(page.locator(".detail-panel")).toContainText("Visuel non renseigné");
  await expect(page.locator(".detail-panel img")).toHaveCount(0);
  await page.getByRole("button", { name: "Aperçu du site", exact: true }).click();
  await page.getByRole("button", { name: `Voir ${points[0].name}`, exact: true }).click();
  await expect(page.locator(".detail-panel img")).toHaveAttribute("src", src);
  await expect(page.locator(".position-editor")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("on mobile, hovering a row cannot move it away before the click selects its photo", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  for (const point of points.slice(0, 2)) {
    const button = page.locator(".list-panel").getByRole("button", { name: `${point.name} ${point.type}`, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".detail-title")).toContainText(point.name);
    await expect(page.locator(".detail-panel img")).toHaveJSProperty("naturalWidth", 1);
  }
});

test("ZIP embeds each photo once and the artisan viewer displays it without network requests", async ({ page, context }) => {
  let imageLoads = 0;
  await page.route("**/api/product-image?*", route => {
    imageLoads++;
    return route.fulfill({ json: { dataUrl: `data:image/png;base64,${png}` } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Exporter pour GitHub Pages" }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Télécharger l’archive" }).click();
  const stream = await (await downloading).createReadStream();
  if (!stream) throw new Error("Missing download");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const html = strFromU8(unzipSync(Buffer.concat(chunks))["index.html"]);
  expect(imageLoads).toBe(1);
  expect(html.split(png).length - 1).toBe(1);
  const viewer = await context.newPage();
  const unexpected: string[] = [];
  const url = "https://artisan.example/apartment-electricity/";
  await viewer.route(/^https?:/, route => {
    if (route.request().url() === url) return route.fulfill({ contentType: "text/html", body: html });
    unexpected.push(route.request().url());
    return route.abort();
  });
  await viewer.goto(url);
  await viewer.locator("[data-marker]").click();
  await expect(viewer.locator(".detail-panel img")).toHaveJSProperty("naturalWidth", 1);
  await expect(viewer.locator(".detail-panel img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(viewer.locator(".cost-item-table img")).toHaveCount(2);
  expect(unexpected).toEqual([]);
  await viewer.close();
});

test("broken photos and failed embedding have explicit messages instead of a successful incomplete export", async ({ page }) => {
  await page.route(src, route => route.fulfill({ status: 404, body: "Missing" }));
  await page.route("**/api/product-image?*", route => route.fulfill({
    status: 502, json: { error: "Impossible de télécharger le visuel constructeur (HTTP 404)." },
  }));
  await page.goto("/");
  await page.locator("[data-marker]").click();
  await expect(page.locator(".detail-panel")).toContainText("Image indisponible");
  await page.getByRole("button", { name: "Exporter pour GitHub Pages" }).click();
  let downloaded = false;
  page.on("download", () => { downloaded = true; });
  await page.getByRole("button", { name: "Télécharger l’archive" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("HTTP 404");
  expect(downloaded).toBe(false);
  await expect(page.getByRole("button", { name: "Télécharger l’archive" })).toBeEnabled();
});
