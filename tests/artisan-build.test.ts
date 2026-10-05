import assert from "node:assert/strict";
import { test } from "node:test";
import { buildArtisanHtml, readArtisanConfig } from "../src/lib/artisan-build";
import { artisanSnapshotSchema } from "../src/lib/artisan";
import type { Point } from "../src/lib/model";

const config = { token: "notion-test-secret", databaseId: "database-id", sourceId: "source-id" };
const assets = { imageData: "data:image/jpeg;base64,YQ==", script: "console.log('viewer')", css: "body { color: blue; }" };
const point: Point = {
  id: "private-page-id", name: "Prise", type: "Prise double", price: 13.19,
  existing: false, zone: "Cuisine", zoneExport: "https://notion.so/private-zone",
  position: { x: 12, y: 64 }, notes: "Pour artisan", url: "https://notion.so/private-page",
};

test("CI requires explicit Notion credentials and never falls back to CSV", () => {
  assert.throws(() => readArtisanConfig({}), /NOTION_TOKEN/);
  assert.throws(() => readArtisanConfig({ NOTION_TOKEN: config.token }), /NOTION_DATABASE_ID/);
  assert.throws(() => readArtisanConfig({ NOTION_TOKEN: " ", NOTION_DATABASE_ID: "db" }), /NOTION_TOKEN/);
  assert.deepEqual(readArtisanConfig({
    NOTION_TOKEN: config.token, NOTION_DATABASE_ID: config.databaseId, NOTION_DATA_SOURCE_ID: " ",
  }), { token: config.token, databaseId: config.databaseId, sourceId: undefined });
});

test("CI exports only a sanitized, read-only snapshot with saved Notion positions and inline assets", async () => {
  const html = await buildArtisanHtml(config, assets, async (token, databaseId, sourceId) => {
    assert.deepEqual({ token, databaseId, sourceId }, config);
    return [point];
  });
  const json = html.match(/<script type="application\/json" id="artisan-data">([^]*?)<\/script>/)?.[1];
  assert.ok(json);
  const snapshot = artisanSnapshotSchema.parse(JSON.parse(json));
  assert.equal(snapshot.dataset.source, "notion");
  assert.equal(snapshot.dataset.canSavePositions, false);
  assert.deepEqual(snapshot.dataset.points[0].position, point.position);
  assert.equal(snapshot.dataset.points[0].price, 13.19);
  assert.equal(snapshot.dataset.points[0].notes, point.notes);
  for (const privateValue of [config.token, config.databaseId, config.sourceId, point.id, point.url!, point.zoneExport]) {
    assert.ok(!html.includes(privateValue));
  }
  assert.equal(JSON.parse(json).imageData, assets.imageData);
  assert.ok(html.includes(assets.script));
  assert.ok(html.includes(assets.css));
});

test("failed Notion reads abort the CI build instead of publishing stale or fallback data", async () => {
  await assert.rejects(buildArtisanHtml(config, assets, async () => {
    throw new Error("Notion unavailable");
  }), /Notion unavailable/);
});

test("CI refuses to publish a token accidentally included in a note", async () => {
  await assert.rejects(buildArtisanHtml(config, assets, async () => [
    { ...point, notes: config.token },
  ]), /contient le token/);
});
