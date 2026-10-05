import assert from "node:assert/strict";
import { test } from "node:test";
import { pendingPositions, samePosition, savePositionsSchema, type Point } from "../src/lib/model";
import { localWriteEnabled, writeRequestError } from "../src/lib/write-access";

const id = "00000000-0000-4000-8000-000000000001";
const point: Point = {
  id, name: "Prise", type: "Prise basse", price: null, existing: false,
  zone: "Chambre", zoneExport: "Chambre", position: { x: 0, y: 50 }, notes: "", url: null,
};
test("only local coordinates different from the source are pending", () => {
  assert.deepEqual(pendingPositions([point], { [id]: { x: 0, y: 50 } }), []);
  assert.deepEqual(pendingPositions([point], { [id]: { x: 10, y: 50 }, "csv:obsolete": { x: 1, y: 1 } }), [
    { id, position: { x: 10, y: 50 }, expectedPosition: { x: 0, y: 50 } },
  ]);
  assert.equal(samePosition(null, null), true);
  assert.equal(samePosition(null, { x: 0, y: 0 }), false);
});
test("write payload rejects unknown properties, CSV identifiers, duplicate IDs and invalid coordinates", () => {
  const change = { id, position: { x: 0, y: 100 }, expectedPosition: null };
  assert.equal(savePositionsSchema.safeParse({ changes: [change] }).success, true);
  for (const input of [
    { changes: [] },
    { changes: [change, change] },
    { changes: [{ ...change, id: "csv:Prise" }] },
    { changes: [{ ...change, position: { x: 101, y: 0 } }] },
    { changes: [{ ...change, title: "unexpected mutation" }] },
    { changes: [change], token: "not allowed" },
  ]) assert.equal(savePositionsSchema.safeParse(input).success, false);
});
test("writes are local-development-only and require same origin and JSON", () => {
  const url = "http://127.0.0.1:4321/api/prises";
  const request = (origin = "http://127.0.0.1:4321", contentType = "application/json") =>
    new Request(url, { method: "POST", headers: { Origin: origin, "Content-Type": contentType } });
  assert.equal(writeRequestError(request(), true), null);
  assert.ok(writeRequestError(request(), false));
  assert.ok(writeRequestError(request("https://external.example"), true));
  assert.ok(writeRequestError(request("", "text/plain"), true));
  assert.ok(writeRequestError(new Request(url, { method: "POST" }), true));
  assert.equal(localWriteEnabled(new URL("https://public.example"), true), false);
  assert.equal(localWriteEnabled(new URL("http://localhost:4321"), true), true);
  assert.equal(localWriteEnabled(new URL("http://[::1]:4321"), true), true);
});
