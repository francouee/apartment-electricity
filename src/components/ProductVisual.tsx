import { useState } from "react";
import type { Point } from "../lib/model";

function Image({ image }: { image: NonNullable<Point["productImages"]>[number] }) {
  const [failed, setFailed] = useState(false);
  return <figure>
    {failed ? <span className="product-image-missing" role="status">Image indisponible</span>
      : <img src={image.src} alt={image.name} title={image.name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}
    <figcaption>{image.name}</figcaption>
  </figure>;
}

export default function ProductVisual({ images, compact = false }: { images: Point["productImages"]; compact?: boolean }) {
  return <div className={`product-visuals${compact ? " compact" : ""}`}>
    {images?.length ? images.map((image, index) => <Image key={`${image.src}:${index}`} image={image} />)
      : <span className="product-image-missing">Visuel non renseigné</span>}
  </div>;
}
