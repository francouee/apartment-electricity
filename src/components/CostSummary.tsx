import { formatCost, summarizeCosts } from "../lib/cost-summary";
import type { Point } from "../lib/model";

export default function CostSummary({ points }: { points: Point[] }) {
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
    <p className="cost-note">
      {summary.missingCount > 0 && `${summary.missingCount} équipement${summary.missingCount > 1 ? "s" : ""} sans prix : le total reste à compléter. `}
      Chaque ligne est comptée une fois, sans déduire de quantité du nom. Montants hors main-d’œuvre.
    </p>
  </section>;
}
