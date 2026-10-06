const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const IMAGE_ORIGINS = new Set(["https://assets.legrand.com"]);

export async function loadCatalogueImage(src: string): Promise<string> {
  if (!URL.canParse(src)) throw new Error("L'URL du visuel constructeur est invalide.");
  const url = new URL(src);
  if (!IMAGE_ORIGINS.has(url.origin) || url.username || url.password) {
    throw new Error("L'export des images accepte uniquement les visuels HTTPS de assets.legrand.com.");
  }
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Impossible de télécharger le visuel constructeur (HTTP ${response.status}).`);
  const mime = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (!mime || !IMAGE_TYPES.has(mime)) throw new Error("Le visuel constructeur doit être une image JPEG, PNG, WebP ou GIF.");
  if (!response.body) throw new Error("Le visuel constructeur est vide.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error("Le visuel constructeur dépasse la limite de 8 Mo.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size) throw new Error("Le visuel constructeur est vide.");
  let binary = "";
  for (const chunk of chunks) {
    for (let start = 0; start < chunk.length; start += 8192) {
      binary += String.fromCharCode(...chunk.subarray(start, start + 8192));
    }
  }
  return `data:${mime};base64,${btoa(binary)}`;
}
