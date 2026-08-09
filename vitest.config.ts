import { configDefaults, defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Delivery-layer tests that must NOT run in jsdom: Server Actions and Route
// Handlers are server-only code, and a DOM around them only hides mistakes.
const SERVER_ONLY_APP_TESTS = ["**/*.action.test.ts", "**/*.route.test.ts"];

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
            // Infrastructure unit tests (pure mapping logic, no live Supabase needed)
            "src/**/infrastructure/**/*.test.ts",
            // Server Actions and Route Handlers under src/app — server-only
            ...SERVER_ONLY_APP_TESTS.map((pattern) => `src/app/${pattern}`),
          ],
          // Exclude integration tests that require a live Supabase stack
          exclude: ["**/*.integration.test.ts", "**/node_modules/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: [
            "src/**/ui/**/*.test.{ts,tsx}",
            // Delivery-layer (app) component tests that need jsdom
            "src/app/**/*.test.{ts,tsx}",
          ],
          // Without this the server-only tests would also run here, in jsdom.
          exclude: [...configDefaults.exclude, ...SERVER_ONLY_APP_TESTS],
        },
      },
      {
        extends: true,
        test: {
          // Integration tests require a live local Supabase stack (SUPABASE_TEST_URL).
          // Run with: pnpm test:integration
          // NOT included in the default pnpm test gate.
          name: "integration",
          environment: "node",
          include: ["src/**/*.integration.test.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Coverage thresholds scoped to domain + application only.
      // Infrastructure adapters require a live Supabase stack for full
      // integration coverage and are excluded from the 100%/80% gates.
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
