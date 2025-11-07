import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    alias: {
      "@src": path.resolve(__dirname, "./src"),
      ":core": path.resolve(__dirname, "./src/core"),
      ":util": path.resolve(__dirname, "./src/util"),
    },
  },
});
