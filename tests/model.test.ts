import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePoints } from "../src/lib/csv";
import { coordinatePair, exportCsv, pointColor, positionsSchema } from "../src/lib/model";

const csv = readFileSync(new URL("../src/data/prises.csv", import.meta.url), "utf8");
test("imports the 32 real entries without inventing positions or prices", () => {
  const points = parsePoints(csv);
  assert.equal(points.length, 32);
  assert.equal(new Set(points.map((point) => point.id)).size, 32);
  assert.equal(points.filter((point) => point.existing).length, 8);
  assert.ok(points.every((point) => point.position === null && point.price === null));
  assert.deepEqual([...new Set(points.map((point) => point.zone))].sort(), ["Chambre", "Couloir", "Cuisine + Salon", "SDB"]);
});
test("coordinates accept zero but reject incomplete, invalid or out-of-range pairs", () => {
  assert.equal(coordinatePair("", ""), null);
  assert.deepEqual(coordinatePair(0, 100), { x: 0, y: 100 });
  for (const [x, y] of [["", "4"], ["101", "2"], ["abc", "2"], ["-1", "2"]]) {
    assert.throws(() => coordinatePair(x, y));
  }
  assert.equal(positionsSchema.safeParse({ bad: { x: Infinity, y: 0 } }).success, false);
});
test("export round-trips names, notes, relations and local coordinates", () => {
  const points = parsePoints(csv);
  points[0].notes = 'Une note, avec "guillemets"\net une nouvelle ligne.';
  const exported = parsePoints(exportCsv(points, { [points[0].id]: { x: 12.25, y: 70.5 } }));
  assert.deepEqual(exported[0], { ...points[0], position: { x: 12.25, y: 70.5 } });
  assert.deepEqual(exported.slice(1), points.slice(1));
});
test("duplicate CSV names and malformed schemas are not silently accepted", () => {
  assert.throws(() => parsePoints(csv + csv.split("\n")[1] + "\n"));
  assert.throws(() => parsePoints("Nom,Type\nPrise,Prise basse"));
});
test("legend keeps the original semantics and distinguishes fibre", () => {
  assert.equal(pointColor("interrupteur"), "#367daa");
  assert.equal(pointColor("Prise haute"), "#d44d58");
  assert.equal(pointColor("Prise basse / Sortie de câble"), "#278561");
  assert.equal(pointColor("sortie Fibre internet"), "#8368af");
});
