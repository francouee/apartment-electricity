import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isNotionClientError } from "@notionhq/client";
import { buildArtisanHtml, readArtisanConfig } from "../src/lib/artisan-build";

try {
  const config = readArtisanConfig(process.env);
  const [image, script, css] = await Promise.all([
    readFile(new URL("../public/plan.jpeg", import.meta.url)),
    readFile(new URL("../.generated/artisan-viewer.js", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/global.css", import.meta.url), "utf8"),
  ]);
  const html = await buildArtisanHtml(config, {
    imageData: `data:image/jpeg;base64,${image.toString("base64")}`,
    script,
    css,
  });
  const output = new URL("../.artisan/", import.meta.url);
  await mkdir(output, { recursive: true });
  await writeFile(new URL("index.html", output), html);
  await writeFile(new URL(".nojekyll", output), "");
  console.log("Page artisan generee dans .artisan/ depuis Notion, sans serveur ni credentials.");
} catch (error) {
  const message = isNotionClientError(error)
    ? `Notion refuse la lecture (${error.code}). Verifiez le secret et les acces aux bases et zones.`
    : error instanceof Error ? error.message : "Erreur inconnue.";
  const token = process.env.NOTION_TOKEN?.trim();
  console.error("Echec de la construction artisan :", token ? message.replaceAll(token, "<REDACTED>") : message);
  process.exitCode = 1;
}
