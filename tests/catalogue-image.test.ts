import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { loadCatalogueImage } from "../src/lib/catalogue-image";

const src = "https://assets.legrand.com/pim/product.jpg";
test("downloads only supported raster images without credentials or redirects", async () => {
  const mocked = mock.method(globalThis, "fetch", async (input: URL, options: RequestInit) => {
    assert.equal(String(input), src);
    assert.equal(options.redirect, "error");
    assert.equal(options.headers, undefined);
    assert.ok(options.signal);
    return new Response("image-bytes", { headers: { "content-type": "image/jpeg" } });
  });
  try {
    assert.equal(await loadCatalogueImage(src), `data:image/jpeg;base64,${btoa("image-bytes")}`);
  } finally { mocked.mock.restore(); }
});

test("image export rejects other origins, credentials, insecure URLs and invalid URLs before fetching", async () => {
  const mocked = mock.method(globalThis, "fetch", () => { throw new Error("Must not fetch"); });
  try {
    for (const url of ["https://127.0.0.1/image.jpg", "http://assets.legrand.com/image.jpg", "https://user:password@assets.legrand.com/image.jpg", "https://assets.legrand.com.evil.example/image.jpg", "not-a-url"]) {
      await assert.rejects(loadCatalogueImage(url), /uniquement|invalide/);
    }
    assert.equal(mocked.mock.callCount(), 0);
  } finally { mocked.mock.restore(); }
});

test("image download errors, unsupported types, empty content and oversized content stop the export", async () => {
  for (const [response, expected] of [
    [new Response("missing", { status: 404 }), /HTTP 404/],
    [new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }), /JPEG/],
    [new Response("", { headers: { "content-type": "image/png" } }), /vide/],
    [new Response(new Uint8Array(8 * 1024 * 1024 + 1), { headers: { "content-type": "image/png" } }), /8 Mo/],
  ] as const) {
    const mocked = mock.method(globalThis, "fetch", async () => response);
    try { await assert.rejects(loadCatalogueImage(src), expected); }
    finally { mocked.mock.restore(); }
  }
});
