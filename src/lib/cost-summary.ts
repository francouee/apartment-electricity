import type { Point } from "./model";

const decimalPrice = new Intl.NumberFormat("en-US", {
  useGrouping: false, minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export type RoomCost = {
  room: string;
  count: number;
  pricedCount: number;
  missingCount: number;
  cents: number;
};

export function summarizeCosts(points: Point[]) {
  const rooms = new Map<string, RoomCost>();
  for (const point of points) {
    const room = point.zone.trim() || "Sans pièce";
    let cost = rooms.get(room);
    if (!cost) {
      cost = { room, count: 0, pricedCount: 0, missingCount: 0, cents: 0 };
      rooms.set(room, cost);
    }
    cost.count++;
    if (point.price === null) {
      cost.missingCount++;
    } else {
      cost.pricedCount++;
      cost.cents += Math.round(Number(decimalPrice.format(point.price)) * 100);
    }
  }
  const sorted = [...rooms.values()].sort((a, b) => a.room.localeCompare(b.room, "fr"));
  return {
    rooms: sorted,
    count: points.length,
    pricedCount: sorted.reduce((sum, room) => sum + room.pricedCount, 0),
    missingCount: sorted.reduce((sum, room) => sum + room.missingCount, 0),
    cents: sorted.reduce((sum, room) => sum + room.cents, 0),
  };
}

export function formatCost(cents: number): string {
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}
