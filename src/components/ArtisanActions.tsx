import { useEffect, useRef, useState } from "react";
import { strToU8, zipSync } from "fflate";
import css from "../styles/global.css?raw";
import { createArtisanHtml, createArtisanSnapshot, type ArtisanSnapshot } from "../lib/artisan";
import type { Dataset, Position } from "../lib/model";

type Props = {
  dataset: Dataset | null;
  positions: Record<string, Position>;
  disabled: boolean;
  onPreview: (snapshot: ArtisanSnapshot) => void;
};

async function imageAsDataUrl(): Promise<string> {
  const response = await fetch("/plan.jpeg");
  if (!response.ok) throw new Error(`Impossible d’intégrer le plan (HTTP ${response.status}).`);
  const image = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Impossible de lire l’image du plan."));
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result) : reject(new Error("Le contenu de l’image est invalide."));
    reader.readAsDataURL(image);
  });
}

export default function ArtisanActions({ dataset, positions, disabled, onPreview }: Props) {
  const [snapshot, setSnapshot] = useState<ArtisanSnapshot | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (snapshot && dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
  }, [snapshot]);

  async function download(snapshot: ArtisanSnapshot) {
    setExporting(true);
    setError("");
    setNotice("");
    try {
      const [{ default: viewerScript }, imageData] = await Promise.all([
        import("../../.generated/artisan-viewer.js?raw"),
        imageAsDataUrl(),
      ]);
      const html = createArtisanHtml(snapshot, imageData, viewerScript, css);
      const archive = zipSync({
        "index.html": strToU8(html),
        ".nojekyll": new Uint8Array(),
        "LISEZ-MOI.txt": strToU8("Vue artisan en lecture seule.\nDécompressez cette archive et publiez index.html à la racine de votre dépôt GitHub Pages.\nDans Settings > Pages : Deploy from a branch, choisissez votre branche et / (root).\nLa page contient le plan, les noms, zones, notes, prix et positions au moment de l'export.\nAucun token, aucun serveur ni connexion Notion ne sont nécessaires.\nPour actualiser le partage, remplacez index.html avec un nouvel export.\n"),
      });
      const url = URL.createObjectURL(new Blob([new Uint8Array(archive)], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "plan-electricite-artisan.zip";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSnapshot(null);
      setNotice("Export téléchargé. Publiez le fichier index.html de l’archive sur GitHub Pages.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export impossible.");
    } finally {
      setExporting(false);
    }
  }

  return <>
    <button disabled={disabled || !dataset || exporting}
      onClick={() => dataset && onPreview(createArtisanSnapshot(dataset, positions))}>Vue artisan</button>
    <button disabled={disabled || !dataset || exporting} onClick={() => {
      if (!dataset) return;
      setError("");
      setNotice("");
      setSnapshot(createArtisanSnapshot(dataset, positions));
    }}>Exporter pour GitHub Pages</button>
    {notice && <p className="export-message" role="status">{notice}</p>}
    {snapshot && <dialog ref={dialogRef} className="save-dialog" aria-labelledby="export-heading"
      onCancel={(event) => { if (exporting) event.preventDefault(); else setSnapshot(null); }}>
      <h2 id="export-heading">Partager la vue artisan</h2>
      <p>L’archive contient une page autonome en lecture seule : le plan et les {snapshot.dataset.points.length} entrées, avec les notes et les prix renseignés.</p>
      <p>Les placements locaux sont inclus, même s’ils ne sont pas encore enregistrés dans Notion. Aucun filtre ne retire d’entrée de l’export.</p>
      <p><strong>Un site GitHub Pages est généralement public.</strong> Vérifiez les informations avant de publier. Aucun token ni lien Notion n’est intégré.</p>
      <p>Les données sont figées : un nouvel export sera nécessaire après une modification.</p>
      {error && <p className="message error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button disabled={exporting} autoFocus onClick={() => setSnapshot(null)}>Annuler</button>
        <button className="primary" disabled={exporting} onClick={() => void download(snapshot)}>
          {exporting ? "Préparation…" : "Télécharger l’archive"}
        </button>
      </div>
    </dialog>}
  </>;
}
