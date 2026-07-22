// @ts-check
import { FlatCompat } from "@eslint/eslintrc";
import boundaries from "eslint-plugin-boundaries";
import importPlugin from "eslint-plugin-import";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/** @type {import('eslint').Linter.Config[]} */
const config = [
  // Extend Next.js recommended config
  ...compat.extends("next/core-web-vitals"),

  // Global ignores
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "**/*.d.ts",
    ],
  },

  // TypeScript files configuration
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      "@typescript-eslint": tsPlugin,
      boundaries,
      import: importPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname,
      },
    },
    settings: {
      "boundaries/include": ["src/**/*", "app/**/*"],
      "boundaries/elements": [
        { type: "app", pattern: "app/**", mode: "full" },
        { type: "shared-domain", pattern: "src/shared/domain/**" },
        { type: "shared-app", pattern: "src/shared/application/**" },
        { type: "shared-infra", pattern: "src/shared/infrastructure/**" },
        { type: "shared-ui", pattern: "src/shared/ui/**" },
        {
          type: "domain",
          pattern: "src/modules/*/domain/**",
          capture: ["module"],
        },
        {
          type: "application",
          pattern: "src/modules/*/application/**",
          capture: ["module"],
        },
        {
          type: "infrastructure",
          pattern: "src/modules/*/infrastructure/**",
          capture: ["module"],
        },
        {
          type: "ui",
          pattern: "src/modules/*/ui/**",
          capture: ["module"],
        },
      ],
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: "./tsconfig.json",
        },
      },
    },
    rules: {
      // Boundaries rules — encode hexagonal architecture
      "boundaries/no-unknown": "off",
      "boundaries/no-private": "off",
      "boundaries/element-types": [
        "error",
        {
          default: "disallow",
          rules: [
            // DOMAIN: innermost — may only import shared-domain or same module domain
            {
              from: ["domain", "shared-domain"],
              allow: [
                "shared-domain",
                ["domain", { module: "${from.module}" }],
              ],
            },
            // APPLICATION: may import domain (same module) + shared-domain + shared-app
            {
              from: ["application", "shared-app"],
              allow: [
                "shared-domain",
                "shared-app",
                ["domain", { module: "${from.module}" }],
                ["application", { module: "${from.module}" }],
              ],
            },
            // INFRASTRUCTURE: may import domain + application (same module) + shared layers
            {
              from: ["infrastructure", "shared-infra"],
              allow: [
                "shared-domain",
                "shared-app",
                "shared-infra",
                ["domain", { module: "${from.module}" }],
                ["application", { module: "${from.module}" }],
              ],
            },
            // UI: may import domain + application (same module) + shared layers
            {
              from: ["ui", "shared-ui"],
              allow: [
                "shared-domain",
                "shared-app",
                "shared-ui",
                ["domain", { module: "${from.module}" }],
                ["application", { module: "${from.module}" }],
              ],
            },
            // APP (delivery layer): may compose everything
            {
              from: ["app"],
              allow: [
                "shared-domain",
                "shared-app",
                "shared-ui",
                "shared-infra",
                "ui",
                "application",
                ["infrastructure", { module: "*" }],
              ],
            },
          ],
        },
      ],
      // Ban framework imports in pure layers (belt-and-suspenders)
      "boundaries/external": [
        "error",
        {
          default: "allow",
          rules: [
            {
              from: ["domain", "shared-domain", "application", "shared-app"],
              disallow: ["react", "react-dom", "next", "next/*", "@supabase/*"],
              message:
                "Pure layers (domain/application) must not import React/Next/Supabase.",
            },
          ],
        },
      ],
      // Import order rules
      "import/order": [
        "error",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
          ],
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "import/no-cycle": "error",
    },
  },
];

export default config;
