import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { readNotion, saveNotionPositions, PositionSaveError } from "../src/lib/notion";
import type { PositionChange } from "../src/lib/model";

const richText = (value: string) => ({ type: "rich_text", rich_text: [{ plain_text: value }] });
const page = (id: string) => ({
  object: "page",
  id,
  url: `https://www.notion.so/${id}`,
  properties: {
    Nom: { type: "title", title: [{ plain_text: `Prise ${id}` }] },
    Type: { type: "select", select: { name: "Prise basse" } },
    Prix: { type: "number", number: null },
    "Déjà présente ?": { type: "checkbox", checkbox: true },
    "🗺️ Zones": { id: "zone-property", type: "relation", relation: [{ id: "chambre" }] },
    X: { type: "number", number: 0 },
    Y: { type: "number", number: 70 },
    Notes: richText("Une vraie note"),
  },
});

test("Notion paginates entries and resolves each shared zone only once", async () => {
  const queries: string[] = [];
  let zoneRequests = 0;
  const mocked = mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token");
    if (url.pathname.endsWith("/databases/database")) {
      return Response.json({ object: "database", data_sources: [{ id: "source" }] });
    }
    if (url.pathname.endsWith("/data_sources/source/query")) {
      const body = JSON.parse(String(init?.body));
      queries.push(body.start_cursor ?? "first");
      return Response.json({
        results: [page(body.start_cursor ? "second" : "first")],
        has_more: !body.start_cursor,
        next_cursor: body.start_cursor ? null : "cursor-2",
      });
    }
    if (url.pathname.endsWith("/pages/chambre")) {
      zoneRequests++;
      return Response.json({ object: "page", url: "https://www.notion.so/chambre", properties: { Nom: { type: "title", title: [{ plain_text: "Chambre" }] } } });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  try {
    const points = await readNotion("test-token", "database");
    assert.equal(points.length, 2);
    assert.deepEqual(queries, ["first", "cursor-2"]);
    assert.equal(zoneRequests, 1);
    assert.equal(points[0].zone, "Chambre");
    assert.deepEqual(points[0].position, { x: 0, y: 70 });
    assert.equal(points[0].existing, true);
    assert.equal(points[0].notes, "Une vraie note");
  } finally {
    mocked.mock.restore();
  }
});

test("Notion rejects ambiguous databases instead of selecting a random data source", async () => {
  const mocked = mock.method(globalThis, "fetch", async () =>
    Response.json({ object: "database", data_sources: [{ id: "one" }, { id: "two" }] }),
  );
  try {
    await assert.rejects(() => readNotion("test-token", "database"), /NOTION_DATA_SOURCE_ID/);
  } finally {
    mocked.mock.restore();
  }
});

const firstId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";
const changes: PositionChange[] = [firstId, secondId].map((id) => ({
  id, position: { x: 12, y: 60 }, expectedPosition: { x: 0, y: 70 },
}));

function writeFixture(failSecond = false) {
  const writes: { id: string; body: unknown }[] = [];
  const mocked = mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    if (path.endsWith("/data_sources/source/query")) {
      return Response.json({ results: [page(firstId), page(secondId)], has_more: false, next_cursor: null });
    }
    if (path.endsWith("/pages/chambre")) {
      return Response.json({ ...page("chambre"), properties: { Nom: { type: "title", title: [{ plain_text: "Chambre" }] } } });
    }
    if (init?.method === "PATCH") {
      const id = path.split("/").at(-1)!;
      const body = JSON.parse(String(init.body));
      writes.push({ id, body });
      if (failSecond && id === secondId) {
        return Response.json({ object: "error", status: 403, code: "restricted_resource", message: "No write permission" }, { status: 403 });
      }
      const result = page(id);
      result.properties.X.number = body.properties.X.number;
      result.properties.Y.number = body.properties.Y.number;
      return Response.json(result);
    }
    throw new Error(`Unexpected fixture request: ${path}`);
  });
  return { writes, mocked };
}

test("explicit saving only patches X/Y of existing entries and confirms the returned numbers", async () => {
  const { writes, mocked } = writeFixture();
  try {
    const result = await saveNotionPositions("test-token", "database", "source", changes);
    assert.deepEqual(result.saved, changes.map(({ id, position }) => ({ id, position })));
    assert.equal(result.error, undefined);
    assert.deepEqual(writes, changes.map((change) => ({
      id: change.id, body: { properties: { X: { number: 12 }, Y: { number: 60 } } },
    })));
  } finally { mocked.mock.restore(); }
});

test("outside-base IDs and changed coordinates are rejected before any mutation", async () => {
  const { writes, mocked } = writeFixture();
  try {
    await assert.rejects(
      () => saveNotionPositions("test-token", "database", "source", [{ ...changes[0], id: "00000000-0000-4000-8000-000000000099" }]),
      (error: unknown) => error instanceof PositionSaveError && error.status === 400,
    );
    await assert.rejects(
      () => saveNotionPositions("test-token", "database", "source", [{ ...changes[0], expectedPosition: null }]),
      (error: unknown) => error instanceof PositionSaveError && error.status === 409,
    );
    assert.equal(writes.length, 0);
  } finally { mocked.mock.restore(); }
});

test("a write failure reports confirmed pages only and stops the batch", async () => {
  const { writes, mocked } = writeFixture(true);
  try {
    const result = await saveNotionPositions("test-token", "database", "source", changes);
    assert.deepEqual(result.saved, [{ id: firstId, position: { x: 12, y: 60 } }]);
    assert.match(result.error ?? "", /Mettre à jour le contenu/);
    assert.equal(writes.length, 2);
  } finally { mocked.mock.restore(); }
});

test("reads price from the constructor rollup, including an empty relation and numeric aggregations", async () => {
  const cases = [
    { value: { type: "number", number: 14.67 }, expected: 14.67 },
    { value: { type: "rollup", rollup: { type: "array", array: [{ type: "number", number: 13.19 }], function: "show_original" } }, expected: 13.19 },
    { value: { type: "rollup", rollup: { type: "array", array: [], function: "show_original" } }, expected: null },
    { value: { type: "rollup", rollup: { type: "array", array: [{ type: "number", number: null }], function: "show_original" } }, expected: null },
    { value: { type: "rollup", rollup: { type: "number", number: 27.86, function: "sum" } }, expected: 27.86 },
    { value: { type: "rollup", rollup: { type: "number", number: 0, function: "sum" } }, expected: 0 },
  ];
  for (const { value, expected } of cases) {
    const original = page(firstId);
    const mocked = mock.method(globalThis, "fetch", async () => Response.json({
      results: [{
        ...original,
        properties: { ...original.properties, Prix: value, "🗺️ Zones": { type: "select", select: { name: "Chambre" } } },
      }],
      has_more: false, next_cursor: null,
    }));
    try {
      const points = await readNotion("test-token", "database", "source");
      assert.equal(points[0].price, expected);
      assert.deepEqual(points[0].position, { x: 0, y: 70 });
    } finally { mocked.mock.restore(); }
  }
});

test("ambiguous or non-numeric price rollups give explicit errors instead of a made-up total", async () => {
  for (const [rollup, expected] of [
    [{ type: "array", array: [{ type: "number", number: 13.19 }, { type: "number", number: 14.67 }], function: "show_original" }, /plusieurs tarifs/],
    [{ type: "array", array: [{ type: "rich_text", rich_text: [{ plain_text: "13 euros" }] }], function: "show_original" }, /colonne Nombre/],
    [{ type: "incomplete", incomplete: {}, function: "sum" }, /résultat numérique complet/],
  ] as const) {
    const original = page(firstId);
    const mocked = mock.method(globalThis, "fetch", async () => Response.json({
      results: [{
        ...original,
        properties: { ...original.properties, Prix: { type: "rollup", rollup }, "🗺️ Zones": { type: "select", select: { name: "Chambre" } } },
      }],
      has_more: false, next_cursor: null,
    }));
    try {
      await assert.rejects(() => readNotion("test-token", "database", "source"), expected);
    } finally { mocked.mock.restore(); }
  }
});
