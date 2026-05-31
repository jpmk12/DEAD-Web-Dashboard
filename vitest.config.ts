import { defineConfig } from "vitest/config";
import path from "path";

// Unit tests for pure logic only (no DB / network / React). The `@` alias
// mirrors tsconfig so test imports match app imports.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
