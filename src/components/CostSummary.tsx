import { formatCost, summarizeCosts } from "../lib/cost-summary";
import type { Point } from "../lib/model";
import ProductVisual from "./ProductVisual";

export default function CostSummary({ points, selectedId, onSelect }: {
  points: Point[]; selectedId: string | null; onSelect: (id: string) => void;
}) {
  const summary = summarizeCosts(points);
  return <section className="cost-summary" aria-labelledby="cost-heading">
    <div className="panel-header">
      <div>
        <h2 id="cost-heading">Prix par pièce</h2>
        <p className="cost-scope">Toutes les entrées, indépendamment des filtres, y compris les équipements déjà présents.</p>
      </div>
      <div className="cost-total">
        <span>{summary.missingCount ? "Total connu (partiel)" : "Total"}</span>
        <strong>{summary.pricedCount ? formatCost(summary.cents) : "Non renseigné"}</strong>
      </div>
    </div>
    <div className="cost-table-wrap">
      <table className="cost-table">
        <caption className="sr-only">Prix des prises et interrupteurs regroupés par pièce</caption>
        <thead><tr><th scope="col">Pièce</th><th scope="col">Équipements</th><th scope="col">Prix manquants</th><th scope="col">Sous-total connu</th></tr></thead>
        <tbody>{summary.rooms.map((room) => <tr key={room.room}>
          <th scope="row">{room.room}</th>
          <td>{room.count}</td>
          <td>{room.missingCount ? room.missingCount : "Aucun"}</td>
          <td>{room.pricedCount ? formatCost(room.cents) : "Non renseigné"}</td>
        </tr>)}</tbody>
        <tfoot><tr><th scope="row">{summary.missingCount ? "Total connu (partiel)" : "Total"}</th><td>{summary.count}</td><td>{summary.missingCount || "Aucun"}</td><td>{summary.pricedCount ? formatCost(summary.cents) : "Non renseigné"}</td></tr></tfoot>
      </table>
    </div>
    <div className="cost-breakdown">{summary.rooms.map((room) => <details className="room-cost-details" key={room.room} open>
      <summary><strong>{room.room}</strong><span>{room.count} équipement{room.count > 1 ? "s" : ""}</span></summary>
      <div className="cost-table-wrap">
        <table className="cost-item-table">
          <caption className="sr-only">Détail des prises et interrupteurs : {room.room}</caption>
          <thead><tr><th scope="col">Visuel constructeur</th><th scope="col">Prise / interrupteur</th><th scope="col">Installation</th><th scope="col">Prix</th></tr></thead>
          <tbody>{points.filter((point) => (point.zone.trim() || "Sans pièce") === room.room).map((point) => <tr key={point.id} className={selectedId === point.id ? "selected" : ""}>
            <td><button className="cost-image-button" aria-label={`Voir le visuel de ${point.name}`} onClick={() => onSelect(point.id)}>
              <ProductVisual images={point.productImages} compact />
            </button></td>
            <th scope="row"><button className="cost-point-button" aria-label={`Voir ${point.name}`} aria-pressed={selectedId === point.id} onClick={() => onSelect(point.id)}>
              {point.name}<small>{point.type}</small>
              {Boolean(point.productImages?.length) && <small className="cost-product-name" title={point.productImages?.map((image) => image.name).join(" + ")}>
                {point.productImages?.map((image) => image.name).join(" + ")}
              </small>}
            </button></th>
            <td>{point.existing ? "Déjà présente" : "À créer"}</td>
            <td>{point.price === null ? "Non renseigné" : point.price.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>)}</div>
    <p className="cost-note">
      {summary.missingCount > 0 && `${summary.missingCount} équipement${summary.missingCount > 1 ? "s" : ""} sans prix : le total reste à compléter. `}
      Chaque ligne est comptée une fois, sans déduire de quantité du nom. Montants hors main-d’œuvre.
    </p>
  </section>;
}
