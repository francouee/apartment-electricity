import { Client, isFullPage, isNotionClientError } from "@notionhq/client";
import type { PageObjectResponse } from "@notionhq/client/build/src/api-endpoints";
import {
  coordinatePair, pointSchema, samePosition, savePositionsSchema,
  type Point, type PositionChange, type SaveResult,
} from "./model";

type Property = PageObjectResponse["properties"][string];

export class NotionSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotionSchemaError";
  }
}

function text(property: Property): string {
  switch (property.type) {
    case "title": return property.title.map((part) => part.plain_text).join("");
    case "rich_text": return property.rich_text.map((part) => part.plain_text).join("");
    case "select": return property.select?.name ?? "";
    case "multi_select": return property.multi_select.map((value) => value.name).join(", ");
    default: throw new Error(`Type de propriété texte non pris en charge : ${property.type}`);
  }
}

function property(page: PageObjectResponse, name: string): Property {
  const value = page.properties[name];
  if (!value) throw new Error(`Colonne Notion manquante : ${name}`);
  return value;
}

function number(page: PageObjectResponse, name: string): number | null {
  const value = property(page, name);
  if (value.type !== "number") throw new Error(`La colonne ${name} doit être de type Nombre.`);
  return value.number;
}

function price(page: PageObjectResponse): number | null {
  const value = property(page, "Prix");
  if (value.type === "number") return value.number;
  if (value.type !== "rollup") {
    throw new NotionSchemaError("La colonne Prix doit être un Nombre ou une agrégation (rollup) numérique du catalogue constructeur.");
  }
  const rollup = value.rollup;
  if (rollup.type === "number") return rollup.number;
  if (rollup.type === "array") {
    if (rollup.array.length === 0) return null;
    if (rollup.array.length > 1) {
      throw new NotionSchemaError("L'agrégation Prix renvoie plusieurs tarifs. Choisissez un seul produit par prise ou configurez explicitement le calcul « Somme » dans Notion.");
    }
    const item = rollup.array[0];
    if (item.type !== "number") {
      throw new NotionSchemaError("L'agrégation Prix doit lire une colonne Nombre du catalogue constructeur.");
    }
    return item.number;
  }
  throw new NotionSchemaError("L'agrégation Prix n'est pas un résultat numérique complet. Vérifiez son calcul et l'accès de l'intégration à la base constructeur.");
}

export async function readNotion(token: string, databaseId: string, explicitSourceId?: string): Promise<Point[]> {
  const client = new Client({ auth: token, timeoutMs: 15_000 });
  let sourceId = explicitSourceId;
  if (!sourceId) {
    const database = await client.databases.retrieve({ database_id: databaseId });
    if (!("data_sources" in database)) throw new Error("Impossible de lire les sources de la base Notion.");
    if (database.data_sources.length !== 1) {
      throw new Error("Définissez NOTION_DATA_SOURCE_ID : cette base contient plusieurs sources de données.");
    }
    sourceId = database.data_sources[0].id;
  }
  const zoneNames = new Map<string, Promise<string>>();
  const catalogueImages = new Map<string, Promise<{ name: string; src: string } | null>>();
  const catalogueImage = (id: string) => {
    let pending = catalogueImages.get(id);
    if (!pending) {
      pending = client.pages.retrieve({ page_id: id }).then((page) => {
        if (!isFullPage(page)) throw new NotionSchemaError("Partagez le catalogue constructeur avec l'intégration Notion pour lire ses images.");
        const image = page.properties.image;
        if (!image) return null;
        if (image.type !== "url") throw new NotionSchemaError("La colonne image du catalogue constructeur doit être de type URL.");
        if (!image.url) return null;
        if (!image.url.startsWith("https://")) throw new NotionSchemaError("Les images du catalogue constructeur doivent utiliser une URL HTTPS.");
        const title = Object.values(page.properties).find((value) => value.type === "title");
        if (!title) throw new NotionSchemaError("Un produit constructeur ne possède pas de titre.");
        return { name: text(title), src: image.url };
      });
      catalogueImages.set(id, pending);
    }
    return pending;
  };
  const relationIds = async (page: PageObjectResponse, value: Property): Promise<string[]> => {
    if (value.type !== "relation") throw new NotionSchemaError("Les zones et le catalogue constructeur doivent être des relations.");
    if (value.relation.length < 25 && !("has_more" in value && value.has_more === true)) return value.relation.map((item) => item.id);
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const items = await client.pages.properties.retrieve({ page_id: page.id, property_id: value.id, start_cursor: cursor });
      if (items.object !== "list") throw new NotionSchemaError("Une relation Notion n'est pas une liste.");
      for (const item of items.results) {
        if (item.type !== "relation") throw new NotionSchemaError("Une relation Notion est incohérente.");
        ids.push(item.relation.id);
      }
      if (items.has_more && !items.next_cursor) throw new NotionSchemaError("Pagination d'une relation Notion incomplète.");
      cursor = items.has_more ? items.next_cursor ?? undefined : undefined;
    } while (cursor);
    return ids;
  };
  const zoneTitle = (id: string): Promise<string> => {
    let pending = zoneNames.get(id);
    if (!pending) {
      pending = client.pages.retrieve({ page_id: id }).then((page) => {
        if (!isFullPage(page)) throw new Error("Accès incomplet à une zone. Partagez aussi les pages Zones avec l'intégration.");
        const title = Object.values(page.properties).find((value) => value.type === "title");
        if (!title) throw new Error("Une zone Notion ne possède pas de titre.");
        return text(title);
      });
      zoneNames.set(id, pending);
    }
    return pending;
  };
  const points: Point[] = [];
  let cursor: string | undefined;
  do {
    const response = await client.dataSources.query({
      data_source_id: sourceId, page_size: 100, start_cursor: cursor,
    });
    for (const page of response.results) {
      if (!isFullPage(page)) throw new Error("Une entrée Notion est inaccessible ou n'est pas une page.");
      const zones = property(page, "🗺️ Zones");
      let zone: string;
      if (zones.type === "relation") {
        zone = (await Promise.all((await relationIds(page, zones)).map(zoneTitle))).join(", ");
      } else {
        zone = text(zones);
      }
      const existing = property(page, "Déjà présente ?");
      if (existing.type !== "checkbox") throw new Error("La colonne Déjà présente ? doit être une case à cocher.");
      const catalogue = page.properties["prises BOM"];
      const images = catalogue ? await Promise.all((await relationIds(page, catalogue)).map(catalogueImage)) : [];
      points.push(pointSchema.parse({
        id: page.id,
        name: text(property(page, "Nom")).trim(),
        type: text(property(page, "Type")),
        price: price(page),
        existing: existing.checkbox,
        zone,
        zoneExport: zone,
        position: coordinatePair(number(page, "X"), number(page, "Y")),
        notes: text(property(page, "Notes")),
        url: page.url,
        productImages: images.filter((image) => image !== null),
      }));
    }
    if (response.has_more && !response.next_cursor) throw new Error("Pagination Notion incomplète.");
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);
  return points;
}

export class PositionSaveError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "PositionSaveError";
  }
}

export function notionSaveError(error: unknown): string {
  if (error instanceof PositionSaveError) return error.message;
  if (error instanceof NotionSchemaError) return error.message;
  if (isNotionClientError(error)) {
    if (error.code === "restricted_resource") {
      return "Notion refuse l'écriture. Activez la permission « Mettre à jour le contenu » de l'intégration et son accès à la base.";
    }
    if (error.code === "unauthorized") return "Le token Notion est invalide. Vérifiez le fichier .env.";
    if (error.code === "validation_error") return "Notion a refusé les coordonnées. Vérifiez que X et Y sont des colonnes Nombre.";
    if (error.code === "object_not_found") return "Une prise n'est plus accessible dans Notion. Actualisez la liste et vérifiez les accès.";
  }
  return "Impossible de confirmer la sauvegarde dans Notion. Les changements non confirmés restent locaux ; actualisez et réessayez.";
}

export async function saveNotionPositions(
  token: string, databaseId: string, sourceId: string | undefined, input: PositionChange[],
): Promise<SaveResult> {
  const { changes } = savePositionsSchema.parse({ changes: input });
  const current = new Map((await readNotion(token, databaseId, sourceId)).map((point) => [point.id, point]));
  for (const change of changes) {
    const point = current.get(change.id);
    if (!point) throw new PositionSaveError("Une prise ne fait pas partie de cette base. Actualisez avant de sauvegarder.", 400);
    if (!samePosition(point.position, change.expectedPosition)) {
      throw new PositionSaveError(`Les coordonnées de « ${point.name} » ont changé dans Notion. Actualisez et vérifiez le placement avant de confirmer à nouveau.`, 409);
    }
  }
  const client = new Client({ auth: token, timeoutMs: 15_000 });
  const saved: SaveResult["saved"] = [];
  for (const change of changes) {
    try {
      const page = await client.pages.update({
        page_id: change.id,
        properties: { X: { number: change.position.x }, Y: { number: change.position.y } },
      });
      if (!isFullPage(page)) throw new Error("Réponse Notion incomplète.");
      const confirmed = coordinatePair(number(page, "X"), number(page, "Y"));
      if (!confirmed || !samePosition(confirmed, change.position)) throw new Error("Coordonnées Notion non confirmées.");
      saved.push({ id: change.id, position: confirmed });
    } catch (error) {
      console.error("Sauvegarde des positions interrompue.", isNotionClientError(error) ? error.code : "Réponse non confirmée");
      return { saved, error: notionSaveError(error) };
    }
  }
  return { saved };
}
