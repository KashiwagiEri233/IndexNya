import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const esbuildEntry = path.join(root, "node_modules", "esbuild", "lib", "main.js");
if (!fs.existsSync(esbuildEntry)) {
  throw new Error("找不到 esbuild，请先在项目根目录执行 npm install");
}
const { build } = await import(pathToFileURL(esbuildEntry).href);

await build({
  entryPoints: [path.join(root, "src", "electron", "main.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: path.join(root, "dist-electron", "main.cjs"),
  sourcemap: true,
  external: ["electron", "node:*"],
  legalComments: "none",
});

await build({
  entryPoints: [path.join(root, "src", "electron", "preload.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: path.join(root, "dist-electron", "preload.cjs"),
  sourcemap: true,
  external: ["electron", "node:*"],
  legalComments: "none",
});

console.log("Electron 脚本已成功编译至 dist-electron/");
