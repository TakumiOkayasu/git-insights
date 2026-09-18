import { defineConfig } from "vite";
export default defineConfig({
  build: {
    target: "node20",
    outDir: "dist",
    lib: { entry: "src/extension.ts", formats: ["cjs"], fileName: () => "extension.cjs" },
    rolldownOptions: { external: [/^node:/, "vscode"] },
    sourcemap: true,
  },
});
