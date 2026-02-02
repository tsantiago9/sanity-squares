import { defineConfig } from "vite";
import { resolve } from "path";
import fs from "fs";

export default defineConfig({
  build: {
    outDir: "dist",
  },
  plugins: [
    {
      name: "copy-swa-config",
      closeBundle() {
        fs.copyFileSync(
          resolve(__dirname, "staticwebapp.config.json"),
          resolve(__dirname, "dist/staticwebapp.config.json")
        );
      },
    },
  ],
});
