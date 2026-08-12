import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // An underscore prefix is this codebase's existing, deliberate signal for
    // "this parameter exists to satisfy a signature and is not used" — almost
    // entirely Supabase-client mocks in tests (`(_table, _args) => …`). Without
    // this, those produced 22 of 37 warnings: enough noise that the whole lint
    // list read as background and stopped being read at all. That is not
    // hypothetical — a real `'hasAnchor' is assigned a value but never used`
    // sat in that list while the dashboard silently hid its projection tile
    // from every new household. Keeping the list short is what keeps it read.
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
      }],
    },
  },
]);

export default eslintConfig;
