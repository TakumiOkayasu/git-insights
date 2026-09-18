import { defineConfig } from "vite";
export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist/webview",
    emptyOutDir: true,
    lib: {
      entry: "src/webview/main.ts",
      formats: ["iife"],
      name: "GitInsights",
      fileName: () => "main.js",
      cssFileName: "main",
    },
  },
});
