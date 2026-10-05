import { createArtisanHtml, createArtisanSnapshot } from "./artisan";
import { readNotion } from "./notion";

export interface ArtisanBuildConfig {
  token: string;
  databaseId: string;
  sourceId?: string;
}

export function readArtisanConfig(env: Record<string, string | undefined>): ArtisanBuildConfig {
  const token = env.NOTION_TOKEN?.trim();
  const databaseId = env.NOTION_DATABASE_ID?.trim();
  if (!token) throw new Error("NOTION_TOKEN manquant : configurez le secret GitHub Actions.");
  if (!databaseId) throw new Error("NOTION_DATABASE_ID manquant : configurez la variable GitHub Actions.");
  return { token, databaseId, sourceId: env.NOTION_DATA_SOURCE_ID?.trim() || undefined };
}

export async function buildArtisanHtml(
  config: ArtisanBuildConfig,
  assets: { imageData: string; script: string; css: string },
  readPoints: typeof readNotion = readNotion,
): Promise<string> {
  const points = await readPoints(config.token, config.databaseId, config.sourceId);
  const snapshot = createArtisanSnapshot({
    source: "notion",
    updatedAt: new Date().toISOString(),
    canSavePositions: false,
    points,
  }, {});
  const html = createArtisanHtml(snapshot, assets.imageData, assets.script, assets.css);
  if (html.includes(config.token)) throw new Error("Publication interrompue : le contenu contient le token Notion.");
  return html;
}
