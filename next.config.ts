import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// On Render the public URL is only known as RENDER_EXTERNAL_URL (set at build and runtime).
// Assigning undefined to process.env stores the string "undefined", so only copy a real value.
if (!process.env.NEXT_PUBLIC_SITE_URL && process.env.RENDER_EXTERNAL_URL) process.env.NEXT_PUBLIC_SITE_URL = process.env.RENDER_EXTERNAL_URL;

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
