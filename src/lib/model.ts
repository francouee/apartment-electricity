import { z } from "zod";

export const positionSchema = z.object({
  x: z.number().finite().min(0).max(100),
  y: z.number().finite().min(0).max(100),
});
export type Position = z.infer<typeof positionSchema>;
export const positionsSchema = z.record(positionSchema);
export const pointSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string(),
  price: z.number().finite().nullable(),
  existing: z.boolean(),
  zone: z.string(),
  zoneExport: z.string(),
  position: positionSchema.nullable(),
  notes: z.string(),
  url: z.string().url().nullable(),
});
export type Point = z.infer<typeof pointSchema>;
export const datasetSchema = z.object({
  source: z.enum(["csv", "notion"]),
  updatedAt: z.string(),
  points: z.array(pointSchema),
  canSavePositions: z.boolean().optional(),
});
export type Dataset = z.infer<typeof datasetSchema>;
export const apiErrorSchema = z.object({ error: z.string() });

export const positionChangeSchema = z.object({
  id: z.string().uuid(),
  position: positionSchema,
  expectedPosition: positionSchema.nullable(),
}).strict();
export type PositionChange = z.infer<typeof positionChangeSchema>;
export const savePositionsSchema = z.object({
  changes: z.array(positionChangeSchema).min(1).max(200)
    .refine((changes) => new Set(changes.map((change) => change.id)).size === changes.length, "Identifiants en double."),
}).strict();
export const saveResultSchema = z.object({
  saved: z.array(z.object({ id: z.string().uuid(), position: positionSchema })),
  error: z.string().optional(),
});
export type SaveResult = z.infer<typeof saveResultSchema>;

export function samePosition(a: Position | null, b: Position | null): boolean {
  return a === null || b === null ? a === b : a.x === b.x && a.y === b.y;
}

export function pendingPositions(points: Point[], positions: Record<string, Position>): PositionChange[] {
  return points.flatMap((point) => {
    const position = positions[point.id];
    return position && !samePosition(position, point.position)
      ? [{ id: point.id, position, expectedPosition: point.position }]
      : [];
  });
}

export function coordinatePair(x: string | number | null, y: string | number | null): Position | null {
  const empty = (value: string | number | null) => value === null || (typeof value === "string" && value.trim() === "");
  if (empty(x) && empty(y)) return null;
  if (empty(x) || empty(y)) throw new Error("X et Y doivent être renseignés ensemble.");
  return positionSchema.parse({ x: Number(x), y: Number(y) });
}

export function pointColor(type: string): string {
  if (type.toLowerCase().includes("interrupteur")) return "#367daa";
  if (type.toLowerCase().includes("haute")) return "#d44d58";
  if (type.toLowerCase().includes("fibre")) return "#8368af";
  return "#278561";
}

export function exportCsv(points: Point[], positions: Record<string, Position>): string {
  const cell = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const lines = points.map((point) => {
    const position = positions[point.id] ?? point.position;
    return [point.name, point.type, point.price ?? "", point.existing ? "Yes" : "No",
      point.zoneExport, position?.x ?? "", position?.y ?? "", point.notes].map(cell).join(",");
  });
  return "\uFEFFNom,Type,Prix,Déjà présente ?,🗺️ Zones,X,Y,Notes\r\n" + lines.join("\r\n");
}
