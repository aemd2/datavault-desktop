/**
 * Regenerate build-resources/icon.ico from build-resources/icon.png.
 *
 * Windows uses a multi-resolution .ico bundle for the taskbar, Start menu,
 * desktop shortcut, file explorer, and Alt+Tab switcher. If the .ico only
 * contains small sizes (e.g. 16x16, 32x32), Windows upscales them and the
 * icon looks pixelated -- which is exactly the bug v1.1.1 shipped with.
 *
 * This script reads the 512x512 source PNG, generates PNG buffers at every
 * size Windows actually requests, then bakes them into a single .ico file.
 *
 * Run with:  npm run icons
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC_PNG = path.join(ROOT, "build-resources", "icon.png");
const OUT_ICO = path.join(ROOT, "build-resources", "icon.ico");

// Windows asks for these sizes in different surfaces. Including all of
// them means no upscaling artefacts anywhere in the OS.
const SIZES = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  const src = await fs.readFile(SRC_PNG);

  // Resize the source PNG to each target size with high-quality Lanczos3.
  const buffers = await Promise.all(
    SIZES.map((size) =>
      sharp(src)
        .resize(size, size, { fit: "contain", kernel: "lanczos3" })
        .png()
        .toBuffer(),
    ),
  );

  const ico = await pngToIco(buffers);
  await fs.writeFile(OUT_ICO, ico);

  console.log(
    `wrote ${OUT_ICO} (${SIZES.join(", ")} px, ${(ico.length / 1024).toFixed(1)} KB)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
