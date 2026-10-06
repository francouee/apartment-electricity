import type { APIRoute } from "astro";
import { loadCatalogueImage } from "../../lib/catalogue-image";

export const GET: APIRoute = async ({ url }) => {
  try {
    const dataUrl = await loadCatalogueImage(url.searchParams.get("url") ?? "");
    return Response.json({ dataUrl }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Intégration du visuel constructeur impossible.", error instanceof Error ? error.name : "Erreur inconnue");
    return Response.json({
      error: error instanceof Error ? error.message : "Impossible d'intégrer le visuel constructeur.",
    }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
};
