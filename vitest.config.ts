import path from "path";

// Unit tests for pure logic only (no DB / network / React). The `@` alias
// mirrors tsconfig so test imports match app imports.
//
// Deliberately NOT importing defineConfig from "vitest/config": vitest is not
// installed in the project tree (the esbuild deploy ban — see CLAUDE.md), so
// `npm test` runs the npx-cached vitest, which transpiles this config in the
// project context where `vitest/config` doesn't resolve. A plain object export
// is accepted by vitest and needs no import.
export default {
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node" as const,
  },
};
