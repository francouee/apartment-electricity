import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeCosts } from "../src/lib/cost-summary";
import type { Point } from "../src/lib/model";

function point(room: string, price: number | null): Point {
  return {
    id: `${room}:${price}`, name: "Double prise", type: "Prise basse", price,
    existing: true, zone: room, zoneExport: room, position: null, notes: "", url: null,
  };
}
test("room subtotals and total sum cents, counting one price per row including existing equipment", () => {
  const result = summarizeCosts([point("Chambre", 13.19), point("Cuisine", 0.1), point("Cuisine", 0.2), point("Chambre", 14.67)]);
  assert.deepEqual(result.rooms, [
    { room: "Chambre", count: 2, pricedCount: 2, missingCount: 0, cents: 2786 },
    { room: "Cuisine", count: 2, pricedCount: 2, missingCount: 0, cents: 30 },
  ]);
  assert.equal(result.cents, 2816);
  assert.equal(result.count, 4);
});
test("missing prices stay missing, a real zero is priced, and blank rooms are grouped explicitly", () => {
  const result = summarizeCosts([point("SDB", null), point("Chambre", 0), point("", 12.5), point("SDB", 13.19)]);
  assert.equal(result.missingCount, 1);
  assert.equal(result.pricedCount, 3);
  assert.equal(result.cents, 2569);
  assert.deepEqual(result.rooms.find((room) => room.room === "Chambre"), { room: "Chambre", count: 1, pricedCount: 1, missingCount: 0, cents: 0 });
  assert.equal(result.rooms.find((room) => room.room === "Sans pièce")?.cents, 1250);
});
test("empty or unpriced datasets do not imply a known zero budget", () => {
  assert.equal(summarizeCosts([]).pricedCount, 0);
  const result = summarizeCosts([point("SDB", null)]);
  assert.equal(result.pricedCount, 0);
  assert.equal(result.missingCount, 1);
});
test("a combined zone is a single group rather than duplicating its price in several rooms", () => {
  const result = summarizeCosts([point("Cuisine, Salon", 13.19)]);
  assert.equal(result.rooms.length, 1);
  assert.equal(result.cents, 1319);
});

test("fractional cents are rounded like the displayed currency before summing", () => {
  const result = summarizeCosts([point("Chambre", 10.075), point("Chambre", 1.005), point("Chambre", -0.005)]);
  assert.equal(result.cents, 1108);
});
