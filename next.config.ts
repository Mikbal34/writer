import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Slim standalone server build for the Fly Docker image — copies only
  // the production-needed node_modules + .next/standalone so the runner
  // stage doesn't ship the whole node_modules tree.
  output: "standalone",
  // pdfjs-dist must NOT be bundled on the server. When webpack
  // transpiles it (via transpilePackages), the internal worker
  // import `new URL("pdf.worker.mjs", import.meta.url)` is rewritten
  // to a static `.next/server/chunks/pdf.worker.mjs` path that is
  // never emitted — so every server-side getDocument() throws
  // "Setting up fake worker failed: Cannot find module …" and
  // pdf-extract.ts silently falls back to slow Python OCR (which
  // drops sectionTitle + pdfPageLabel). Marking it external keeps
  // it as a normal node_modules require at runtime, so its worker
  // resolves relative to the real on-disk file. react-pdf (client
  // only, "use client") stays in transpilePackages to fix the .mjs
  // export shape webpack otherwise mishandles in the browser bundle.
  serverExternalPackages: ["@prisma/client", "pdfkit", "pdfjs-dist"],
  transpilePackages: ["react-pdf"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // ESLint is run separately in CI; let `next build` skip its eslint pass.
  // The `eslint` config key was removed from NextConfig types in 16, but
  // the runtime still respects `NEXT_DISABLE_ESLINT_DURING_BUILD=1`.
};

export default nextConfig;
