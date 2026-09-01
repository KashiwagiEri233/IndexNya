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
  entryPoints: [path.join(root, "src", "runtime", "index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: path.join(root, "dist-server", "index.js"),
  sourcemap: true,
  external: ["node:*"],
  legalComments: "none",
});
console.log("TS 全栈服务已打包到 dist-server/index.js");
