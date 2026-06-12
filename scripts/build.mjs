/**
 * Builds dist/: two fully self-contained HTML pages (JS bundled and inlined,
 * zero runtime network dependencies except the firmware hex next to them)
 * plus the versioned firmware hex and a VERSION marker.
 */
import * as esbuild from "esbuild";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
mkdirSync(dist, { recursive: true });

// Exactly one versioned firmware hex must exist in firmware/.
const hexes = readdirSync(join(root, "firmware")).filter((f) => f.endsWith(".hex"));
if (hexes.length !== 1) {
  throw new Error(`Expected exactly one .hex in firmware/, found: ${hexes.join(", ") || "none"}`);
}
const firmwareFilename = hexes[0];

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
let sha = "unknown";
try {
  sha = execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim();
} catch {}
const version = `v${pkg.version} (${sha})`;

async function buildPage(name) {
  const result = await esbuild.build({
    entryPoints: [join(root, `src/${name}/${name}.ts`)],
    bundle: true,
    minify: true,
    format: "iife",
    target: "es2020",
    write: false,
    define: {
      __FIRMWARE_FILENAME__: JSON.stringify(firmwareFilename),
      __TOOLS_VERSION__: JSON.stringify(version),
    },
  });
  const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const html = readFileSync(join(root, `src/${name}/${name}.html`), "utf8");
  const marker = "/*__BUNDLE__*/";
  if (!html.includes(marker)) {
    throw new Error(`${name}.html is missing the ${marker} marker`);
  }
  const out = html.replace(marker, () => js);
  writeFileSync(join(dist, `${name}.html`), out);
  console.log(`dist/${name}.html  ${(out.length / 1024).toFixed(0)} KB`);
}

await buildPage("flasher");
await buildPage("simulator");
copyFileSync(join(root, "firmware", firmwareFilename), join(dist, firmwareFilename));
writeFileSync(join(dist, "VERSION"), version + "\n");
console.log(`dist/${firmwareFilename}`);
console.log(`Build complete: ${version}`);
