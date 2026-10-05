import type { APIRoute } from "astro";
import csv from "../../data/prises.csv?raw";
import { parsePoints } from "../../lib/csv";
import { savePositionsSchema, type Dataset } from "../../lib/model";
import { readNotion, saveNotionPositions, notionSaveError, PositionSaveError, NotionSchemaError } from "../../lib/notion";
import { localWriteEnabled, writeRequestError } from "../../lib/write-access";

let cached: { dataset: Dataset; expires: number; key: string } | undefined;
let saving = false;

export const GET: APIRoute = async ({ url }) => {
  const token = process.env.NOTION_TOKEN || import.meta.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID || import.meta.env.NOTION_DATABASE_ID;
  const sourceId = process.env.NOTION_DATA_SOURCE_ID || import.meta.env.NOTION_DATA_SOURCE_ID;
  const key = `${token ? "notion" : "csv"}:${databaseId}:${sourceId}`;
  try {
    if (!cached || cached.expires <= Date.now() || cached.key !== key) {
      if (token && !databaseId && !sourceId) throw new Error("Définissez NOTION_DATABASE_ID ou NOTION_DATA_SOURCE_ID.");
      const points = token ? await readNotion(token, databaseId ?? "", sourceId) : parsePoints(csv);
      cached = {
        dataset: { source: token ? "notion" : "csv", updatedAt: new Date().toISOString(), points },
        expires: Date.now() + 60_000,
        key,
      };
    }
    return Response.json({
      ...cached.dataset,
      canSavePositions: Boolean(token) && localWriteEnabled(url, import.meta.env.DEV),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Do not log SDK requests or credentials at this HTTP boundary.
    console.error("Lecture des prises impossible.", error instanceof NotionSchemaError ? error.message : error instanceof Error ? error.name : "Erreur inconnue");
    return Response.json({
      error: error instanceof NotionSchemaError ? error.message
        : "Impossible de lire les prises. Vérifiez le token, l'accès à la base, aux Zones et au catalogue constructeur, ainsi que les colonnes décrites dans le README.",
    }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const reply = (error: string, status: number) =>
    Response.json({ saved: [], error }, { status, headers: { "Cache-Control": "no-store" } });
  const accessError = writeRequestError(request, import.meta.env.DEV);
  if (accessError) return reply(accessError, 403);
  const token = process.env.NOTION_TOKEN || import.meta.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID || import.meta.env.NOTION_DATABASE_ID;
  const sourceId = process.env.NOTION_DATA_SOURCE_ID || import.meta.env.NOTION_DATA_SOURCE_ID;
  if (!token || (!databaseId && !sourceId)) return reply("La connexion Notion n'est pas configurée.", 503);
  if (saving) return reply("Une sauvegarde est déjà en cours. Attendez sa fin avant de réessayer.", 409);
  const body = await request.text();
  if (body.length > 64_000) return reply("Trop de données à sauvegarder.", 413);
  let input: unknown;
  try {
    input = JSON.parse(body);
  } catch {
    return reply("Le contenu JSON de la sauvegarde est invalide.", 400);
  }
  const parsed = savePositionsSchema.safeParse(input);
  if (!parsed.success) return reply("Positions invalides : chaque prise doit avoir un identifiant unique et X/Y entre 0 et 100.", 400);
  if (saving) return reply("Une sauvegarde est déjà en cours. Attendez sa fin avant de réessayer.", 409);
  saving = true;
  try {
    const result = await saveNotionPositions(token, databaseId ?? "", sourceId, parsed.data.changes);
    return Response.json(result, {
      status: result.error ? 502 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Sauvegarde Notion impossible.", error instanceof Error ? error.name : "Erreur inconnue");
    return reply(notionSaveError(error), error instanceof PositionSaveError ? error.status : 502);
  } finally {
    saving = false;
    cached = undefined;
  }
};
