import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    rules: {
      // Ban Tailwind arbitrary hex literals in JSX class strings —
      // every approved color has a design token (bg-page, text-ink,
      // border-sandy, etc.). New shades go through globals.css first.
      // Matches `bg-[#xxx]`, `text-[#xxx]`, `border-[#xxx]`, … inside
      // both plain string literals and template strings.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/(bg|text|border|from|via|to|ring|outline|shadow|fill|stroke|caret|decoration|placeholder|accent|divide)-\\[#[a-fA-F0-9]+\\]/]",
          message:
            "Tailwind arbitrary hex literals are banned — use design tokens (bg-page, text-ink, border-sandy, etc.). Add new shades to globals.css first.",
        },
        {
          selector:
            "TemplateElement[value.raw=/(bg|text|border|from|via|to|ring|outline|shadow|fill|stroke|caret|decoration|placeholder|accent|divide)-\\[#[a-fA-F0-9]+\\]/]",
          message:
            "Tailwind arbitrary hex literals are banned — use design tokens (bg-page, text-ink, border-sandy, etc.). Add new shades to globals.css first.",
        },
      ],
    },
  },
]);

export default eslintConfig;
