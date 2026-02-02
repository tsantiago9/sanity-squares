import { defineConfig } from "vite";
import { resolve } from "path";
import fs from "fs";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "index.html"),
    },
  },
  plugins: [
    {
      name: "copy-staticwebapp-config",
      closeBundle() {
        const src = resolve(__dirname, "staticwebapp.config.json");
        const dest = resolve(__dirname, "dist/staticwebapp.config.json");

        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        }
      },
    },
  ],
});
