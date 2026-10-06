import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect } from "@playwright/test";
import { buildArtisanHtml } from "../../src/lib/artisan-build";
import { parsePoints } from "../../src/lib/csv";

test("CI-built artisan HTML works offline with saved positions, prices and no editing controls", async ({ page }, testInfo) => {
  const [image, script, css, csv] = await Promise.all([
    readFile("public/plan.jpeg"),
    readFile(".generated/artisan-viewer.js", "utf8"),
    readFile("src/styles/global.css", "utf8"),
    readFile("src/data/prises.csv", "utf8"),
  ]);
  const points = parsePoints(csv).map((point, index) => ({
    ...point,
    position: index === 0 ? { x: 12, y: 64 } : null,
    price: index === 0 ? 13.19 : index === 1 ? 14.67 : null,
    productImages: index < 2 ? [{ name: "Double prise Legrand", src: "https://assets.legrand.com/product.png" }] : [],
  }));
  const html = await buildArtisanHtml(
    { token: "ci-test-secret", databaseId: "ci-test-database" },
    { imageData: `data:image/jpeg;base64,${image.toString("base64")}`, script, css },
    async () => points,
    async () => "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6sX8AAAAASUVORK5CYII=",
  );
  const file = testInfo.outputPath("ci-artisan", "index.html");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(/^https?:/, route => {
    requests.push(route.request().url());
    return route.abort();
  });
  await page.goto(pathToFileURL(file).href);
  await expect(page).toHaveTitle("Plan électrique");
  await expect(page.locator("main")).not.toContainText(/vue artisan|lecture seule/i);
  await expect(page.locator(".list-panel tbody tr")).toHaveCount(points.length);
  await expect(page.locator("[data-marker]")).toHaveCount(1);
  await expect(page.locator("[data-marker]")).toHaveAttribute("transform", "translate(240, 1280)");
  await expect(page.getByRole("region", { name: "Prix par pièce" })).toContainText("27,86");
  await expect(page.locator(".drag-handle, .position-editor")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Enregistrer dans Notion|Retour au mode admin/ })).toHaveCount(0);
  await expect(page.locator('a[href*="notion"]')).toHaveCount(0);
  await page.locator("[data-marker]").hover();
  await expect(page.locator(".detail-title")).toContainText(points[0].name);
  await expect(page.locator(".detail-panel img")).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(page.locator(".detail-panel img")).toHaveJSProperty("naturalWidth", 1);
  await expect(page.locator(".cost-item-table img")).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});
