import { build } from "esbuild";

await build({
  entryPoints: ["src/artisan/main.tsx"],
  outfile: ".generated/artisan-viewer.js",
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "inline",
});
console.log("Vue artisan autonome générée.");
