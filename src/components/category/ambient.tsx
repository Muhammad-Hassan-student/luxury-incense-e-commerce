"use client";

import { useEffect, useRef } from "react";
import type { Ambient as AmbientKind } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

type P = { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number; seed: number };

/**
 * Canvas-2D ambience per category. Cheap enough to run on phones; pauses off-screen
 * and renders a single still frame with reduced motion.
 */
export function Ambient({ kind, accent, className, intensity = 1 }: { kind: AmbientKind; accent: string; className?: string; intensity?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let raf = 0;
    let visible = false;
    let t = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const particles: P[] = [];
    const rgb = hexToRgb(accent);

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const spawn = (): P => {
      const base = { seed: Math.random(), life: 0 };
      switch (kind) {
        case "SMOKE":
          return { ...base, x: w * (0.5 + (Math.random() - 0.5) * 0.08), y: h * 0.92, vx: (Math.random() - 0.5) * 0.15, vy: -0.35 - Math.random() * 0.3, r: 14 + Math.random() * 16, max: 380 + Math.random() * 200 };
        case "GLOW":
          return { ...base, x: w * (0.3 + Math.random() * 0.4), y: h * 0.85, vx: (Math.random() - 0.5) * 0.4, vy: -0.4 - Math.random() * 0.8, r: 1 + Math.random() * 1.8, max: 160 + Math.random() * 160 };
        case "RIPPLE":
          return { ...base, x: w * (0.3 + Math.random() * 0.4), y: h * (0.4 + Math.random() * 0.3), vx: 0, vy: 0, r: 2, max: 260 };
        case "UNBOX":
          return { ...base, x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.1, vy: -0.05 - Math.random() * 0.15, r: 0.6 + Math.random() * 1.4, max: 200 + Math.random() * 300 };
        default:
          return { ...base, x: w / 2, y: h * 0.6, vx: 0, vy: 0, r: 0, max: 1 };
      }
    };

    const targetCount = { SMOKE: 70, GLOW: 90, RIPPLE: 6, UNBOX: 120, FLAME: 0 }[kind] * intensity;

    const frame = () => {
      t += 1;
      ctx.clearRect(0, 0, w, h);

      if (kind === "FLAME") {
        // Breathing radial glow + a soft flame silhouette.
        const flick = 0.85 + Math.sin(t * 0.21) * 0.05 + Math.sin(t * 0.53) * 0.07 + (Math.random() - 0.5) * 0.04;
        const cx = w / 2;
        const cy = h * 0.62;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.55 * flick);
        g.addColorStop(0, `rgba(255,170,90,${0.38 * flick})`);
        g.addColorStop(0.35, `rgba(${rgb},${0.14 * flick})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        const fh = Math.min(h * 0.18, 120) * flick;
        const sway = Math.sin(t * 0.07) * 4;
        ctx.beginPath();
        ctx.moveTo(cx, cy + fh * 0.3);
        ctx.bezierCurveTo(cx - fh * 0.32, cy, cx - fh * 0.12, cy - fh * 0.5, cx + sway, cy - fh);
        ctx.bezierCurveTo(cx + fh * 0.12, cy - fh * 0.5, cx + fh * 0.32, cy, cx, cy + fh * 0.3);
        const fg = ctx.createLinearGradient(cx, cy - fh, cx, cy + fh * 0.3);
        fg.addColorStop(0, "rgba(255,138,61,0)");
        fg.addColorStop(0.4, "rgba(255,170,90,0.9)");
        fg.addColorStop(1, "rgba(255,246,220,1)");
        ctx.fillStyle = fg;
        ctx.filter = "blur(2px)";
        ctx.fill();
        ctx.filter = "none";
      } else {
        while (particles.length < targetCount) {
          const p = spawn();
          p.life = Math.floor(Math.random() * p.max);
          particles.push(p);
        }
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          p.life++;
          if (p.life > p.max) {
            particles[i] = spawn();
            continue;
          }
          const k = p.life / p.max;
          const fade = Math.min(1, k * 8) * (1 - k);
          if (kind === "SMOKE") {
            p.x += p.vx + Math.sin(t * 0.01 + p.seed * 20 + k * 6) * 0.35 * k;
            p.y += p.vy;
            const r = p.r * (1 + k * 4);
            const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
            g.addColorStop(0, `rgba(${rgb},${0.16 * fade})`);
            g.addColorStop(1, `rgba(${rgb},0)`);
            ctx.fillStyle = g;
            ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
          } else if (kind === "GLOW") {
            p.x += p.vx + Math.sin(t * 0.05 + p.seed * 10) * 0.3;
            p.y += p.vy;
            ctx.fillStyle = `rgba(255,${130 + Math.floor(p.seed * 60)},60,${0.9 * fade})`;
            ctx.shadowColor = "rgba(255,120,40,0.9)";
            ctx.shadowBlur = 8;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
          } else if (kind === "RIPPLE") {
            const r = 4 + k * Math.min(w, h) * 0.4;
            ctx.strokeStyle = `rgba(${rgb},${0.5 * (1 - k)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, r, r * 0.35, 0, 0, Math.PI * 2);
            ctx.stroke();
          } else if (kind === "UNBOX") {
            p.x += p.vx;
            p.y += p.vy;
            const tw = 0.5 + 0.5 * Math.sin(t * 0.1 + p.seed * 50);
            ctx.fillStyle = `rgba(${rgb},${0.8 * fade * tw})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      if (visible && !reduce) raf = requestAnimationFrame(frame);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      cancelAnimationFrame(raf);
      if (visible) raf = requestAnimationFrame(frame);
    });
    io.observe(canvas);
    if (reduce) {
      // One settled frame.
      for (let i = 0; i < 200; i++) frame();
    }
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [kind, accent, intensity]);

  return <canvas ref={ref} className={cn("pointer-events-none h-full w-full", className)} aria-hidden />;
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
