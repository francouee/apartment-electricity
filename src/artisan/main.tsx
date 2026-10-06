import { createRoot } from "react-dom/client";
import ElectricalPlan from "../components/ElectricalPlan";
import { artisanSnapshotSchema, resolveArtisanDataset } from "../lib/artisan";

const root = document.getElementById("artisan-root");
const data = document.getElementById("artisan-data");
if (!root || !data?.textContent) throw new Error("Le fichier de partage est incomplet.");
try {
  const input = JSON.parse(data.textContent);
  const snapshot = artisanSnapshotSchema.parse(input);
  if (typeof input.imageData !== "string" || !input.imageData.startsWith("data:image/jpeg;base64,")) {
    throw new Error("L’image du plan est manquante.");
  }
  createRoot(root).render(<ElectricalPlan
    readOnly
    initialDataset={resolveArtisanDataset(snapshot)}
    snapshotDate={snapshot.exportedAt}
    planImage={input.imageData}
  />);
} catch (error) {
  root.textContent = "Impossible de lire ce fichier de partage. Demandez un nouvel export à l’administrateur.";
  console.error("Export artisan invalide.", error instanceof Error ? error.name : "Erreur inconnue");
}
