import { ImageResponse } from "next/og";
import { brand } from "@/config/brand";

export const alt = brand.name;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "radial-gradient(circle at 50% 70%, #3a2a1e 0%, #0b0a09 65%)", color: "#f3ede4" }}>
        <div style={{ fontSize: 28, letterSpacing: 14, color: "#c8a46a", textTransform: "uppercase" }}>{brand.tagline}</div>
        <div style={{ fontSize: 120, letterSpacing: 30, marginTop: 24, fontWeight: 300 }}>{brand.name.toUpperCase()}</div>
        <div style={{ width: 120, height: 1, background: "#c8a46a", marginTop: 40 }} />
      </div>
    ),
    size,
  );
}
