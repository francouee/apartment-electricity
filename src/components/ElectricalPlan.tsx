import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { select } from "d3-selection";
import { zoom, zoomIdentity, zoomTransform, type ZoomBehavior } from "d3-zoom";
import {
  datasetSchema, apiErrorSchema, exportCsv, pointColor, positionSchema, positionsSchema,
  pendingPositions, samePosition, saveResultSchema,
  type Dataset, type Point, type Position, type PositionChange,
} from "../lib/model";
import { clientToPlan, usePointDrag } from "../lib/use-point-drag";
import CostSummary from "./CostSummary";
import ProductVisual from "./ProductVisual";

const STORAGE_KEY = "tonduti:positions:v1";
const IMAGE_SIZE = 2000;

type Props = {
  readOnly?: boolean;
  initialDataset?: Dataset;
  snapshotDate?: string;
  planImage?: string;
  headerExtra?: ReactNode;
  renderAdminActions?: (dataset: Dataset | null, positions: Record<string, Position>, disabled: boolean) => ReactNode;
};

export default function ElectricalPlan({
  readOnly = false, initialDataset, snapshotDate, planImage = "/plan.jpeg", headerExtra, renderAdminActions,
}: Props) {
  const [dataset, setDataset] = useState<Dataset | null>(initialDataset ?? null);
  const [positions, setPositions] = useState<Record<string, Position>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(!readOnly);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [query, setQuery] = useState("");
  const [zone, setZone] = useState("");
  const [type, setType] = useState("");
  const [unplacedOnly, setUnplacedOnly] = useState(false);
  const [pixelsPerUnit, setPixelsPerUnit] = useState(1);
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<PositionChange[] | null>(null);
  const confirmationRef = useRef<HTMLDialogElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const groupRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const loadSequence = useRef(0);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const detailRef = useRef<HTMLElement>(null);
  const detailContentRef = useRef<HTMLDivElement>(null);
  const drag = usePointDrag(svgRef, groupRef, {
    disabled: readOnly || saving || loading || confirmation !== null,
    onStart: (id) => {
      setSelectedId(id);
      setHoveredId(id);
      setPlacing(false);
    },
    onDrop: savePosition,
    onCancel: () => setNotice("Déplacement annulé. La position précédente est conservée."),
  });

  const load = useCallback(async () => {
    if (readOnly) return;
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/prises");
      const body: unknown = await response.json();
      if (!response.ok) {
        const failure = apiErrorSchema.safeParse(body);
        throw new Error(`Lecture impossible (HTTP ${response.status}). ${failure.success ? failure.data.error : "Vérifiez la configuration Notion et les colonnes du CSV."}`);
      }
      const next = datasetSchema.parse(body);
      if (sequence === loadSequence.current) {
        setDataset(next);
        setHoveredId(null);
        setSelectedId(null);
        setPlacing(false);
      }
    } catch (cause) {
      if (sequence === loadSequence.current) setError(cause instanceof Error ? cause.message : "Lecture impossible.");
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [readOnly]);

  useEffect(() => {
    if (readOnly) return;
    void load();
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setPositions(positionsSchema.parse(JSON.parse(stored)));
    } catch {
      setNotice("Les positions locales sont illisibles ou le stockage est bloqué. Exportez vos nouveaux placements pour les conserver.");
    }
    return () => { loadSequence.current++; };
  }, [load, readOnly]);

  useEffect(() => {
    if (confirmation && confirmationRef.current && !confirmationRef.current.open) confirmationRef.current.showModal();
  }, [confirmation]);

  useEffect(() => {
    const svg = svgRef.current;
    const group = groupRef.current;
    if (!svg || !group) return;
    const behavior = zoom<SVGSVGElement, unknown>()
      .extent([[0, 200], [2000, 1480]])
      .scaleExtent([1, 6])
      .filter((event: Event) => {
        if (drag.isEngaged()) return false;
        const target = event.target;
        if (target instanceof Element && target.closest("[data-marker]")) return false;
        return !placing || event.type === "wheel";
      })
      .on("zoom", (event) => {
        select(group).attr("transform", event.transform.toString());
        setPixelsPerUnit(svg.clientWidth / IMAGE_SIZE * event.transform.k);
      });
    zoomRef.current = behavior;
    select(svg).call(behavior).on("dblclick.zoom", null);
    const observer = new ResizeObserver(() => {
      setPixelsPerUnit(svg.clientWidth / IMAGE_SIZE * zoomTransform(svg).k);
    });
    observer.observe(svg);
    return () => { observer.disconnect(); select(svg).on(".zoom", null); };
  }, [placing]);

  const points = dataset?.points ?? [];
  const getPosition = (point: Point) => positions[point.id] ?? point.position;
  const zones = [...new Set(points.map((point) => point.zone))].sort();
  const types = [...new Set(points.map((point) => point.type))].sort();
  const visible = points.filter((point) =>
    (!zone || point.zone === zone) && (!type || point.type === type) &&
    (!unplacedOnly || !getPosition(point)) &&
    `${point.name} ${point.zone} ${point.notes}`.toLocaleLowerCase("fr").includes(query.toLocaleLowerCase("fr")),
  );
  const selected = points.find((point) => point.id === selectedId);
  const detail = points.find((point) => point.id === hoveredId) ?? selected;
  const positionedCount = points.filter((point) => getPosition(point)).length;
  const pending = dataset?.source === "notion" ? pendingPositions(points, positions) : [];

  function savePosition(id: string, position: Position) {
    if (readOnly || saving) return;
    const parsed = positionSchema.safeParse(position);
    if (!parsed.success) {
      setNotice("Les coordonnées doivent être comprises entre 0 et 100 %.");
      return;
    }
    const next = { ...positions, [id]: parsed.data };
    setPositions(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setNotice("Position enregistrée dans ce navigateur. Notion n'a pas été modifié.");
    } catch {
      setNotice("Position non sauvegardée : stockage local indisponible. Exportez le CSV avant de fermer la page.");
    }
  }

  async function saveToNotion(changes: PositionChange[]) {
    if (readOnly) return;
    setSaving(true);
    setError("");
    setConfirmation(null);
    setPlacing(false);
    try {
      const response = await fetch("/api/prises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      const result = saveResultSchema.parse(await response.json());
      if (result.saved.length) {
        const confirmed = new Map(result.saved.map((item) => [item.id, item.position]));
        setDataset((previous) => previous && ({
          ...previous,
          points: previous.points.map((point) => {
            const position = confirmed.get(point.id);
            return position ? { ...point, position } : point;
          }),
        }));
        const remaining = { ...positions };
        for (const item of result.saved) {
          if (samePosition(remaining[item.id] ?? null, item.position)) delete remaining[item.id];
        }
        setPositions(remaining);
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
        } catch {
          setError("Positions confirmées dans Notion, mais le nettoyage du stockage local a échoué.");
        }
      }
      if (!response.ok || result.error || result.saved.length !== changes.length) {
        const message = result.error ?? "La sauvegarde n'a pas été entièrement confirmée.";
        throw new Error(`${result.saved.length} / ${changes.length} positions confirmées. ${message}`);
      }
      setNotice(`${result.saved.length} position${result.saved.length > 1 ? "s" : ""} enregistrée${result.saved.length > 1 ? "s" : ""} dans Notion.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sauvegarde impossible. Les changements restent locaux.");
    } finally {
      setSaving(false);
    }
  }

  function selectPoint(id: string, scroll: boolean) {
    setSelectedId(id);
    if (detailContentRef.current) detailContentRef.current.scrollTop = 0;
    if (scroll) rowRefs.current.get(id)?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }

  function changeFilter(change: () => void) {
    change();
    setHoveredId(null);
    setPlacing(false);
  }

  function exportPositions() {
    const url = URL.createObjectURL(new Blob([exportCsv(points, positions)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "prises-electricite-positions.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function zoomBy(factor: number) {
    if (svgRef.current && zoomRef.current) select(svgRef.current).call(zoomRef.current.scaleBy, factor);
  }

  return (
    <main className={readOnly ? "artisan-mode" : "admin-mode"}>
      <header className="page-header">
        <div>
          <p className="address">30 rue Tonduti de l’Escarène</p>
          <h1>Le plan électrique</h1>
          <p className="intro">Chaque prise, à sa place.</p>
        </div>
        <div className="header-actions">
          {headerExtra}
          {!readOnly && <button onClick={exportPositions} disabled={!dataset || loading}>Exporter les positions</button>}
          {!readOnly && dataset?.source === "notion" && <button className="primary"
            disabled={!dataset.canSavePositions || !pending.length || loading || saving || drag.draggingId !== null}
            onClick={() => setConfirmation(pending)}>
            {saving ? "Sauvegarde en cours…" : `Enregistrer dans Notion${pending.length ? ` (${pending.length})` : ""}`}
          </button>}
          {!readOnly && renderAdminActions?.(dataset, positions, loading || saving || drag.draggingId !== null)}
        </div>
      </header>

      {confirmation && <dialog ref={confirmationRef} className="save-dialog"
        aria-labelledby="save-heading"
        onCancel={() => setConfirmation(null)}>
        <h2 id="save-heading">Enregistrer les positions dans Notion ?</h2>
        <p>Seules les colonnes X et Y de ces {confirmation.length} entrées seront modifiées, y compris celles masquées par les filtres.</p>
        <ul>{confirmation.map((change) => <li key={change.id}>
          {points.find((point) => point.id === change.id)?.name} : X {change.position.x.toFixed(2)} %, Y {change.position.y.toFixed(2)} %
        </li>)}</ul>
        <div className="dialog-actions">
          <button onClick={() => setConfirmation(null)} autoFocus>Annuler</button>
          <button className="primary" onClick={() => void saveToNotion(confirmation)}>Confirmer la sauvegarde</button>
        </div>
      </dialog>}

      <section className="source-bar" aria-label="Source des données">
        <span><span className="status-dot" />{readOnly ? "Vue artisan · lecture seule" : dataset?.source === "notion" ? `Notion connecté · ${dataset.canSavePositions ? "sauvegarde explicite" : "lecture seule"}` : dataset ? "Export Notion fourni · données locales" : "Chargement des prises…"}</span>
        <span>{positionedCount} / {points.length} emplacements définis</span>
        {!readOnly && <button onClick={() => void load()} disabled={loading || saving || drag.draggingId !== null}>{loading ? "Chargement…" : "Actualiser"}</button>}
      </section>
      {readOnly && snapshotDate && <p className="source-note">Version figée du {new Date(snapshotDate).toLocaleString("fr-FR")}. Les modifications ultérieures de Notion ne sont pas synchronisées.</p>}
      {!readOnly && dataset?.source === "csv" && <p className="source-note">Cette version utilise ton export, pas une connexion en direct. Le token serveur activera la lecture Notion.</p>}
      {!readOnly && dataset?.source === "notion" && <p className="source-note">{pending.length} position(s) locale(s) différente(s) de Notion.
        {!dataset.canSavePositions && " L’écriture est désactivée hors du serveur local de développement."}
      </p>}
      {error && <p className="message error" role="alert">{error}</p>}
      <p className="message notice" role="status">{notice}</p>

      <div className="workspace">
        <section className="plan-panel" aria-labelledby="plan-heading">
          <div className="panel-header">
            <h2 id="plan-heading">L’appartement</h2>
            <div className="zoom-controls">
              <button aria-label="Dézoomer" disabled={drag.draggingId !== null} onClick={() => zoomBy(1 / 1.3)}>−</button>
              <button aria-label="Zoomer" disabled={drag.draggingId !== null} onClick={() => zoomBy(1.3)}>+</button>
              <button disabled={drag.draggingId !== null} onClick={() => {
                if (svgRef.current && zoomRef.current) select(svgRef.current).call(zoomRef.current.transform, zoomIdentity);
              }}>Recentrer</button>
            </div>
          </div>
          <div className={`plan-stage ${placing ? "placing" : ""} ${drag.draggingId ? "drop-target" : ""}`}>
            <svg
              ref={svgRef} viewBox="0 200 2000 1280"
              aria-label="Plan de l’appartement avec ses prises et interrupteurs"
              onClick={(event) => {
                if (readOnly || !placing || !selected || !groupRef.current) return;
                if (!svgRef.current) return;
                const position = clientToPlan(svgRef.current, groupRef.current, event.clientX, event.clientY);
                if (!position) { setNotice("Choisissez un emplacement dans les limites du plan."); return; }
                savePosition(selected.id, position);
                setPlacing(false);
              }}
            >
              <g ref={groupRef}>
                <image href={planImage} width={IMAGE_SIZE} height={IMAGE_SIZE} />
                {visible.map((point) => {
                  const position = drag.preview?.id === point.id ? drag.preview.position : getPosition(point);
                  if (!position) return null;
                  const active = point.id === hoveredId || point.id === selectedId;
                  return (
                    <g key={point.id} data-marker role="button" tabIndex={0}
                      className={drag.draggingId === point.id ? "dragging-marker" : ""}
                      aria-label={`${point.name}, ${point.type}, ${point.zone}`}
                      aria-pressed={point.id === selectedId}
                      transform={`translate(${position.x * 20}, ${position.y * 20})`}
                      onPointerEnter={() => setHoveredId(point.id)}
                      onPointerLeave={() => setHoveredId(null)}
                      onFocus={() => setHoveredId(point.id)}
                      onBlur={() => setHoveredId(null)}
                      onPointerDown={readOnly ? undefined : (event) => drag.start(event, point.id, getPosition(point))}
                      onPointerMove={drag.move}
                      onPointerUp={drag.finish}
                      onPointerCancel={drag.cancel}
                      onLostPointerCapture={drag.cancel}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (!drag.consumeClick(point.id, event.detail)) selectPoint(point.id, true);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectPoint(point.id, true); }
                      }}
                    >
                      <title>{point.name}</title>
                      <circle className={`marker ${active ? "active" : ""}`}
                        r={(active ? 8 : 6) / pixelsPerUnit} fill={pointColor(point.type)} stroke="white" strokeWidth={2 / pixelsPerUnit} />
                      {point.existing && <circle r={2 / pixelsPerUnit} fill="white" pointerEvents="none" />}
                      <circle r={10 / pixelsPerUnit} fill="transparent" />
                    </g>
                  );
                })}
              </g>
            </svg>
            {positionedCount === 0 && !placing && !drag.draggingId && <div className="empty-plan">
              {readOnly ? "Aucun emplacement n’a été défini dans cette version. Les détails restent disponibles dans le tableau." : <>Les emplacements restent à définir.<br />Glisse une prise depuis sa poignée dans le tableau, ou choisis « Placer sur le plan ».</>}
            </div>}
            {placing && selected && <div className="placement-hint">Clique sur le plan pour placer « {selected.name} ».<button onClick={() => setPlacing(false)}>Annuler</button></div>}
          </div>
          <div className="legend">
            {[["#367daa", "Interrupteur"], ["#d44d58", "Prise haute"], ["#278561", "Prise basse / câble"], ["#8368af", "Fibre"]].map(([color, label]) =>
              <span key={label}><i style={{ background: color }} />{label}</span>,
            )}
            <span className="legend-existing">Centre blanc : déjà présente</span>
          </div>
          <p className="plan-note">{readOnly ? "Survole pour consulter, clique pour sélectionner. Molette pour zoomer ; glisse le fond pour déplacer le plan." : "Glisse un point pour le déplacer. Survole pour consulter. Molette pour zoomer ; glisse le fond pour déplacer le plan. Échap annule un déplacement."}</p>
          <section ref={detailRef} className="detail-panel" aria-labelledby="detail-heading">
            <div ref={detailContentRef} className="detail-content">{detail ? <>
              <div className="detail-title"><i style={{ background: pointColor(detail.type) }} /><h3 id="detail-heading">{detail.name}</h3></div>
              <ProductVisual key={detail.id} images={detail.productImages} />
              <dl>
                <div><dt>Zone</dt><dd>{detail.zone || "Non renseignée"}</dd></div>
                <div><dt>Type</dt><dd>{detail.type}</dd></div>
                <div><dt>Installation</dt><dd>{detail.existing ? "Déjà présente" : "À créer"}</dd></div>
                <div><dt>Prix</dt><dd>{detail.price === null ? "Non renseigné" : detail.price.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</dd></div>
              </dl>
              {detail.notes && <p className="notes">{detail.notes}</p>}
              {!readOnly && detail.url && <a href={detail.url} target="_blank" rel="noreferrer">Voir la fiche Notion</a>}
            </> : <><h3 id="detail-heading">Une prise, tous ses détails</h3><p>{readOnly ? "Sélectionne une entrée dans le tableau ou un point sur le plan pour consulter ses détails." : "Sélectionne une entrée dans le tableau pour la consulter ou la positionner."}</p></>}</div>
            {!readOnly && selected && <div className="position-editor">
              <button className="primary" disabled={saving} onClick={() => setPlacing(!placing)}>{placing ? "Annuler le placement" : "Placer sur le plan"}</button>
              <form key={`${selected.id}:${getPosition(selected)?.x}:${getPosition(selected)?.y}`}
                onSubmit={(event) => {
                  event.preventDefault();
                  const values = new FormData(event.currentTarget);
                  const x = String(values.get("x") ?? "");
                  const y = String(values.get("y") ?? "");
                  if (!x.trim() || !y.trim()) { setNotice("Renseignez X et Y."); return; }
                  savePosition(selected.id, { x: Number(x), y: Number(y) });
                }}>
                <label>X (%)<input name="x" type="number" min="0" max="100" step="0.01" required defaultValue={getPosition(selected)?.x.toFixed(2) ?? ""} /></label>
                <label>Y (%)<input name="y" type="number" min="0" max="100" step="0.01" required defaultValue={getPosition(selected)?.y.toFixed(2) ?? ""} /></label>
                <button type="submit" disabled={saving}>Enregistrer</button>
              </form>
              <small>Placement de « {selected.name} ». Coordonnées de l’image complète, origine en haut à gauche.
                {dataset?.source === "notion" ? " Local jusqu’à confirmation avec « Enregistrer dans Notion »." : " Sauvegarde locale uniquement."}
              </small>
            </div>}
          </section>
        </section>

        <section className="list-panel" aria-labelledby="list-heading">
          <div className="panel-header"><h2 id="list-heading">Prises & interrupteurs</h2><span>{visible.length}</span></div>
          <div className="filters">
            <label className="search-label">Rechercher<input type="search" placeholder="Nom, zone ou notes…" value={query} onChange={(event) => changeFilter(() => setQuery(event.target.value))} /></label>
            <label>Zone<select value={zone} onChange={(event) => changeFilter(() => setZone(event.target.value))}><option value="">Toutes les zones</option>{zones.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label>Type<select value={type} onChange={(event) => changeFilter(() => setType(event.target.value))}><option value="">Tous les types</option>{types.map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="checkbox-label"><input type="checkbox" checked={unplacedOnly} onChange={(event) => changeFilter(() => setUnplacedOnly(event.target.checked))} />Sans emplacement uniquement</label>
          </div>
          <div className="table-scroll">
            <table>
              <caption className="sr-only">Prises provenant de {dataset?.source === "notion" ? "Notion" : "l’export CSV"}</caption>
              <thead><tr><th scope="col">Nom / type</th><th scope="col">Zone</th><th scope="col">Plan</th></tr></thead>
              <tbody>{visible.map((point) => <tr key={point.id}
                ref={(element) => { if (element) rowRefs.current.set(point.id, element); else rowRefs.current.delete(point.id); }}
                className={`${point.id === hoveredId ? "hovered" : ""} ${point.id === selectedId ? "selected" : ""}`}
                onPointerEnter={() => setHoveredId(point.id)} onPointerLeave={() => setHoveredId(null)}
                onFocus={() => setHoveredId(point.id)} onBlur={() => setHoveredId(null)}
              >
                <td><div className="row-content">
                  {!readOnly && <button className="drag-handle" aria-label={`Glisser ${point.name} sur le plan`}
                    title="Glisser vers le plan. Au clavier, activer pour placer par clic ou saisir X/Y."
                    disabled={saving || loading}
                    onPointerDown={(event) => drag.start(event, point.id, null)}
                    onPointerMove={drag.move}
                    onPointerUp={drag.finish}
                    onPointerCancel={drag.cancel}
                    onLostPointerCapture={drag.cancel}
                    onClick={(event) => {
                      if (drag.consumeClick(point.id, event.detail)) return;
                      selectPoint(point.id, false);
                      setPlacing(true);
                    }}>
                    <svg width="12" height="18" viewBox="0 0 12 18" aria-hidden="true">
                      {[4, 9, 14].flatMap((y) => [3, 9].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" fill="currentColor" />))}
                    </svg>
                  </button>}
                  <button className="row-button" aria-pressed={point.id === selectedId} onClick={() => selectPoint(point.id, false)}><i style={{ background: pointColor(point.type) }} /><span>{point.name}<small>{point.type}{point.existing ? " · Déjà présente" : ""}</small></span></button>
                </div></td>
                <td>{point.zone}</td>
                <td><span className={getPosition(point) ? "placed-status" : "missing-status"}>{getPosition(point) ? "Placé" : "À placer"}</span></td>
              </tr>)}</tbody>
            </table>
            {!loading && visible.length === 0 && <p className="no-results">Aucune prise ne correspond à ces filtres.</p>}
          </div>
          <p className="list-footnote">Les positions ne sont pas déduites du nom. Elles sont définies par toi sur le plan.</p>
        </section>
      </div>
      {dataset && <CostSummary points={points} selectedId={selectedId} onSelect={(id) => {
        setHoveredId(null);
        selectPoint(id, false);
        detailRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
      }} />}
      <footer>Repérage du projet, pas un schéma électrique réglementaire. Implantations et conformité à valider avec un professionnel.</footer>
    </main>
  );
}
