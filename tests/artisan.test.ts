import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePoints } from "../src/lib/csv";
import { createArtisanHtml, createArtisanSnapshot, embedProductImages, resolveArtisanDataset } from "../src/lib/artisan";
import type { Dataset } from "../src/lib/model";

const dataset: Dataset = {
  source: "csv", updatedAt: new Date().toISOString(), canSavePositions: true,
  points: parsePoints(readFileSync(new URL("../src/data/prises.csv", import.meta.url), "utf8")),
};
test("artisan snapshot includes all local placements and strips Notion links, IDs and write capability", () => {
  const copy = { ...dataset, secret: "must-not-export", points: dataset.points.map((point) => ({
    ...point, url: "https://www.notion.so/private", token: "must-not-export",
  })) };
  const snapshot = createArtisanSnapshot(copy, { [copy.points[0].id]: { x: 12, y: 64 } });
  assert.equal(snapshot.dataset.points.length, 32);
  assert.deepEqual(snapshot.dataset.points[0].position, { x: 12, y: 64 });
  assert.equal(snapshot.dataset.canSavePositions, false);
  assert.ok(snapshot.dataset.points.every((point) => point.id.startsWith("artisan:") && point.url === null && !point.zoneExport.includes("https://")));
  assert.ok(!JSON.stringify(snapshot).includes("must-not-export"));
  assert.equal(copy.points[0].position, null);
});

test("snapshot embeds each distinct product image once and resolves it without external requests", async () => {
  const src = "https://assets.legrand.com/product.jpg";
  const original = createArtisanSnapshot({
    ...dataset, points: dataset.points.slice(0, 2).map((point) => ({
      ...point, productImages: [{ name: "Produit", src }],
    })),
  }, {});
  assert.throws(() => createArtisanHtml(original, "data:image/jpeg;base64,YQ==", "", ""), /intégrés/);
  let calls = 0;
  const snapshot = await embedProductImages(original, async (url) => {
    calls++;
    assert.equal(url, src);
    return "data:image/jpeg;base64,YQ==";
  });
  assert.equal(calls, 1);
  assert.deepEqual(snapshot.productImageAssets, { [src]: "data:image/jpeg;base64,YQ==" });
  assert.ok(resolveArtisanDataset(snapshot).points.every((point) => point.productImages?.[0].src === "data:image/jpeg;base64,YQ=="));
  assert.equal(original.dataset.points[0].productImages?.[0].src, src);
  assert.ok(createArtisanHtml(snapshot, "data:image/jpeg;base64,YQ==", "", ""));
  await assert.rejects(embedProductImages(original, async () => { throw new Error("Image unavailable"); }), /Image unavailable/);
  await assert.rejects(embedProductImages(original, async () => "https://remote.example/image.jpg"));
});
test("standalone HTML safely embeds user notes without allowing script-tag injection", () => {
  const copy = { ...dataset, points: dataset.points.map((point, index) => index === 0
    ? { ...point, notes: '</script><script>window.injected=true</script>\u2028\u2029' } : point) };
  const snapshot = createArtisanSnapshot(copy, {});
  const html = createArtisanHtml(snapshot, "data:image/jpeg;base64,YQ==", 'console.log("</script>")', "body { color: blue; }");
  assert.ok(!html.includes("<script>window.injected"));
  assert.ok(html.includes("\\u003c/script>"));
  const json = html.match(/<script type="application\/json" id="artisan-data">([^]*?)<\/script>/)?.[1];
  assert.ok(json);
  assert.equal(JSON.parse(json).dataset.points[0].notes, copy.points[0].notes);
  assert.throws(() => createArtisanHtml(snapshot, "https://external.example/plan.jpeg", "", ""));
});
