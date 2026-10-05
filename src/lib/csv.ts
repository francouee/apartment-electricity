import { parse } from "csv-parse/sync";
import { z } from "zod";
import { coordinatePair, pointSchema, type Point } from "./model";

const rowSchema = z.object({
  Nom: z.string().trim().min(1),
  Type: z.string(),
  Prix: z.string(),
  "Déjà présente ?": z.enum(["Yes", "No"]),
  "🗺️ Zones": z.string(),
  X: z.string(),
  Y: z.string(),
  Notes: z.string(),
});

export function parsePoints(csv: string): Point[] {
  const rows = z.array(rowSchema).parse(parse(csv, { columns: true, bom: true, skip_empty_lines: true }));
  const names = new Set<string>();
  return rows.map((row) => {
    if (names.has(row.Nom)) throw new Error(`Nom CSV en double : ${row.Nom}. Utilisez des noms uniques.`);
    names.add(row.Nom);
    return pointSchema.parse({
      id: `csv:${row.Nom}`,
      name: row.Nom,
      type: row.Type,
      price: row.Prix.trim() ? Number(row.Prix.replace(",", ".")) : null,
      existing: row["Déjà présente ?"] === "Yes",
      zone: row["🗺️ Zones"].replace(/\s*\(https?:\/\/[^)]+\)/g, "").trim(),
      zoneExport: row["🗺️ Zones"],
      position: coordinatePair(row.X, row.Y),
      notes: row.Notes,
      url: null,
    });
  });
}
