export function localWriteEnabled(url: URL, development: boolean): boolean {
  return development && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

export function writeRequestError(request: Request, development: boolean): string | null {
  const url = new URL(request.url);
  if (!localWriteEnabled(url, development)) {
    return "L'écriture Notion est disponible uniquement sur le serveur local de développement.";
  }
  if (request.headers.get("Origin") !== url.origin) {
    return "La sauvegarde doit être effectuée depuis l'application locale, sur la même origine.";
  }
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return "La sauvegarde attend un contenu JSON.";
  }
  return null;
}
