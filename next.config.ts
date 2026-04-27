import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", "pdfkit"],
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
