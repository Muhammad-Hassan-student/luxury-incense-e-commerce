import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  experimental: {
    // Enables forbidden()/unauthorized() for the admin role gate.
    authInterrupts: true,
  },
  images: {
    // Only our uploads and Cloudinary are optimised; other pasted links render unoptimised.
    localPatterns: [{ pathname: "/uploads/**", search: "" }],
    remotePatterns: [{ protocol: "https", hostname: "res.cloudinary.com", search: "" }],
  },
  transpilePackages: ["three"],
};

export default withNextIntl(nextConfig);
