import { z } from "zod";
import { datasetSchema, type Dataset, type Position } from "./model";

export const artisanSnapshotSchema = z.object({
  dataset: datasetSchema,
  exportedAt: z.string().datetime(),
});
export type ArtisanSnapshot = z.infer<typeof artisanSnapshotSchema>;

export function createArtisanSnapshot(dataset: Dataset, positions: Record<string, Position>): ArtisanSnapshot {
  return artisanSnapshotSchema.parse({
    exportedAt: new Date().toISOString(),
    dataset: {
      source: dataset.source,
      updatedAt: dataset.updatedAt,
      canSavePositions: false,
      points: dataset.points.map((point, index) => ({
        ...point,
        id: `artisan:${index + 1}`,
        position: positions[point.id] ?? point.position,
        zoneExport: point.zone,
        url: null,
      })),
    },
  });
}

export function createArtisanHtml(snapshot: ArtisanSnapshot, imageData: string, script: string, css: string): string {
  artisanSnapshotSchema.parse(snapshot);
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(imageData)) throw new Error("Le fond du plan doit être une image JPEG intégrée.");
  const json = JSON.stringify({ ...snapshot, imageData })
    .replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const safeScript = script.replace(/<\/script/gi, "<\\/script");
  const safeCss = css.replace(/<\/style/gi, "<\\/style");
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Plan électrique partagé avec l’artisan, en lecture seule.">
<title>Plan électrique · Vue artisan</title>
<style>${safeCss}</style>
</head>
<body>
<div id="artisan-root"><p>Chargement du plan électrique…</p></div>
<noscript>Activez JavaScript pour consulter le plan et le tableau interactifs.</noscript>
<script type="application/json" id="artisan-data">${json}</script>
<script>${safeScript}</script>
</body>
</html>`;
}
