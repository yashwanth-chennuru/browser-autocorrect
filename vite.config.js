import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(__dirname);

function copyExtensionAssets() {
  const assetsToCopy = [
    { from: "manifest.json", to: "manifest.json" },
    { from: "src/popup.html", to: "popup.html" },
    { from: "src/popup.js", to: "popup.js" }
  ];

  return {
    name: "copy-extension-assets",
    generateBundle() {
      for (const asset of assetsToCopy) {
        const source = fs.readFileSync(path.resolve(rootDir, asset.from), "utf8");
        this.emitFile({
          type: "asset",
          fileName: asset.to,
          source
        });
      }
    }
  };
}

export default defineConfig({
  plugins: [copyExtensionAssets()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    lib: {
      entry: path.resolve(rootDir, "src/background.js"),
      formats: ["es"],
      fileName: () => "background.js"
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  }
});
