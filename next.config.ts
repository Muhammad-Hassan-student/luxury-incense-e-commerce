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
  // Face check (src/server/security/face-engine.ts) runs ONNX models on onnxruntime-web's WASM backend. Keep it
  // external so it loads its .wasm from node_modules at runtime, and ship only the files the Node build needs.
  serverExternalPackages: ["onnxruntime-web"],
  outputFileTracingIncludes: {
    "/api/security/face/*": [
      "./models/face/*.onnx",
      "./node_modules/onnxruntime-web/dist/ort.node.min.mjs",
      "./node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs",
      "./node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
    ],
  },
  outputFileTracingExcludes: {
    "/api/security/face/*": [
      "./node_modules/onnxruntime-web/dist/*.{jsep,jspi,asyncify}.*",
      "./node_modules/onnxruntime-web/dist/*.map",
      "./node_modules/onnxruntime-web/dist/ort.{all,webgl,webgpu,jspi,wasm,bundle}*",
      "./node_modules/onnxruntime-web/dist/ort.{js,mjs,min.js,min.mjs}",
    ],
  },
  async headers() {
    // Camera and passkeys must be allowed for our own pages (camera=() would silently block the face check).
    const permissions = [
      "camera=(self)",
      "microphone=()",
      "geolocation=()",
      "publickey-credentials-get=(self)",
      "publickey-credentials-create=(self)",
    ].join(", ");
    return [
      { source: "/:path*", headers: [{ key: "Permissions-Policy", value: permissions }] },
      { source: "/api/security/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default withNextIntl(nextConfig);
