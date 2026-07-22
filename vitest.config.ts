import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: [
            "src/**/domain/**/*.test.ts",
            "src/**/application/**/*.test.ts",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: ["src/**/ui/**/*.test.{ts,tsx}"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/domain/**", "src/**/application/**"],
      exclude: ["**/*.test.*", "**/index.ts", "**/*.d.ts"],
      thresholds: {
        "src/**/domain/**": {
          lines: 100,
          functions: 100,
          branches: 100,
          statements: 100,
        },
        "src/**/application/**": {
          lines: 80,
          functions: 80,
          branches: 80,
          statements: 80,
        },
      },
    },
  },
});
