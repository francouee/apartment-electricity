import { useState } from "react";
import ElectricalPlan from "./ElectricalPlan";
import ArtisanActions from "./ArtisanActions";
import type { ArtisanSnapshot } from "../lib/artisan";

export default function AdminApp() {
  const [preview, setPreview] = useState<ArtisanSnapshot | null>(null);
  if (preview) return <ElectricalPlan key="artisan-preview" readOnly
    initialDataset={preview.dataset} snapshotDate={preview.exportedAt}
    headerExtra={<button onClick={() => setPreview(null)}>Retour au mode admin</button>} />;
  return <ElectricalPlan key="admin"
    headerExtra={<a href="https://app.notion.com/p/francouee/3f004b47b668805bb716e95849c52b71" target="_blank" rel="noreferrer">Ouvrir Notion</a>}
    renderAdminActions={(dataset, positions, disabled) =>
    <ArtisanActions dataset={dataset} positions={positions} disabled={disabled} onPreview={setPreview} />
  } />;
}
