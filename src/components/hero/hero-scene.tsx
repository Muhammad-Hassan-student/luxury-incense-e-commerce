"use client";

import { Suspense, useMemo, useRef, type RefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { PerformanceMonitor, Preload, Sparkles } from "@react-three/drei";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import type { Model3D } from "@/generated/prisma/enums";
import { ProductModel } from "@/components/three/models";
import { Smoke } from "@/components/three/smoke";
import { StudioLights } from "@/components/three/stage";
import { SceneModeProvider, useSceneMode } from "@/components/three/shared";
import { useAdaptiveQuality, useOnScreen } from "@/components/three/perf";
import { HERO_RISE_END, HERO_SHOWCASE_END, HERO_SHOWCASE_START, HERO_STATIONS } from "./showcase";

export type HeroProgress = RefObject<{ scroll: number; pointerX: number; pointerY: number }>;

/** Ritual objects laid out along a slow gallery the camera glides through as you scroll. */
const SPACING = 3.6;
/** How far the camera climbs the opening smoke column (world units). */
const RISE = 2.5;

type Station = {
  model: Model3D;
  palette: string[];
  camY: number;
  lookY: number;
  dist: number;
  scale: number;
};
const stations: Station[] = [
  { model: "INCENSE", palette: ["#3A2A1E", "#C8A46A"], camY: 0.3, lookY: 0.35, dist: 4.2, scale: 1 },
  { model: "COIL", palette: ["#2F4A2A", "#C8A46A"], camY: 2.5, lookY: -0.3, dist: 4.3, scale: 1 },
  { model: "PERFUME", palette: ["#5A1E2A", "#D0A45A"], camY: 0.45, lookY: 0.2, dist: 4.1, scale: 1 },
  { model: "OUD", palette: ["#2B1A10", "#C8A46A"], camY: 1.3, lookY: -0.15, dist: 3.7, scale: 1 },
];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Station position (0..3, eased so the camera dwells at each object) for a scroll value. */
function heroStation(scroll: number) {
  const span = HERO_SHOWCASE_END - HERO_SHOWCASE_START;
  const f = Math.min(1, Math.max(0, (scroll - HERO_SHOWCASE_START) / span)) * (HERO_STATIONS - 1);
  const i = Math.min(HERO_STATIONS - 2, Math.floor(f));
  return i + smooth(0.22, 0.78, f - i);
}

function Rig({ progress, still }: { progress: HeroProgress; still: boolean }) {
  // Preallocated: nothing is created per frame.
  const target = useRef(new THREE.Vector3(0, 0.35, 0));
  const rise = useRef(new THREE.Vector3());
  const riseLook = useRef(new THREE.Vector3());
  const tour = useRef(new THREE.Vector3());
  const tourLook = useRef(new THREE.Vector3());
  const primed = useRef(false);
  useFrame((state, delta) => {
    const p = progress.current;
    const scroll = still ? 0 : p.scroll;
    // Wide screens: object sits right of the headline. Portrait: centred and lifted above the text.
    const portrait = state.size.width / state.size.height < 0.85;
    const offX = portrait ? 0 : -1.05;
    const liftY = portrait ? -0.55 : 0;
    const back = portrait ? 1.6 : 0;
    const px = still ? 0 : p.pointerX;
    const py = still ? 0 : p.pointerY;

    // Act 1 — climb the smoke: rise, push in, and drift a little around the column.
    const r = smooth(0, HERO_RISE_END, scroll);
    const s0 = stations[0];
    rise.current.set(
      offX * (1 - r * 0.55) + Math.sin(r * Math.PI) * 0.35 + px * 0.22,
      s0.camY + r * RISE + liftY + py * 0.14,
      s0.dist - r * 1.5 + back,
    );
    riseLook.current.set(offX * 0.55 * (1 - r), s0.lookY + r * (RISE + 0.3) + liftY, 0);

    // Act 2 — the gallery tour.
    const f = heroStation(scroll);
    const i = Math.min(HERO_STATIONS - 2, Math.floor(f));
    const w = f - i;
    const a = stations[i];
    const b = stations[i + 1];
    const x = f * SPACING;
    tour.current.set(
      x + offX + px * 0.22,
      a.camY + (b.camY - a.camY) * w + liftY + py * 0.14,
      a.dist + (b.dist - a.dist) * w + back,
    );
    tourLook.current.set(x + offX * 0.55, a.lookY + (b.lookY - a.lookY) * w + liftY, 0);

    // From the top of the smoke, glide down and across into the tour.
    const blend = smooth(HERO_RISE_END - 0.02, HERO_SHOWCASE_START + 0.12, scroll);
    rise.current.lerp(tour.current, blend);
    riseLook.current.lerp(tourLook.current, blend);

    const k = primed.current && !still ? 1 - Math.exp(-delta * 2.6) : 1;
    primed.current = true;
    state.camera.position.lerp(rise.current, k);
    target.current.lerp(riseLook.current, k);
    state.camera.lookAt(target.current);
  });
  return null;
}

/** Warm light at the burning tips: flickers like real embers and lights the sticks and the smoke's base. */
function EmberGlow({ light }: { light: boolean }) {
  const ref = useRef<THREE.PointLight>(null);
  const { still } = useSceneMode();
  useFrame(({ clock }) => {
    if (!ref.current || still) return;
    const t = clock.elapsedTime;
    ref.current.intensity = (light ? 2.2 : 1.6) * (0.85 + Math.sin(t * 7.3) * 0.06 + Math.sin(t * 13.1 + 1.3) * 0.05 + Math.sin(t * 2.1) * 0.04);
  });
  return <pointLight ref={ref} position={[0, 0.75, 0.25]} color="#ff8a3d" intensity={light ? 2.2 : 1.6} distance={3.2} decay={2} />;
}

function Stations({ smokeColor, light }: { smokeColor: string; light: boolean }) {
  const { still, low } = useSceneMode();
  const groups = useRef<(THREE.Group | null)[]>([]);
  const shown = useRef<boolean[]>([]);
  useFrame((state) => {
    const camX = state.camera.position.x;
    const t = still ? 0 : state.clock.elapsedTime;
    groups.current.forEach((g, i) => {
      if (!g) return;
      // Only stations near the camera are drawn. Hide their meshes/particles, never the group: hiding a group
      // hides its lights too, and a changing light count makes three.js recompile every shader in the scene —
      // a ~1s freeze each time perfume or oud scrolled into view on a real GPU.
      const near = Math.abs(camX + 1 - i * SPACING) < SPACING * 1.15;
      if (shown.current[i] !== near) {
        shown.current[i] = near;
        // Only drawables: a hidden parent group would hide the lights inside it as well.
        g.traverse((o) => {
          const d = o as THREE.Mesh & THREE.Points & THREE.Line & THREE.Sprite;
          if (d.isMesh || d.isPoints || d.isLine || d.isSprite) o.visible = near;
        });
      }
      g.rotation.y = Math.sin(t * 0.12 + i * 1.7) * 0.32 + (i === 1 ? 0.4 : 0);
    });
  });
  return (
    <>
      {stations.map((s, i) => (
        <group key={s.model} position={[i * SPACING, -0.2, 0]}>
          <group
            ref={(g) => {
              groups.current[i] = g;
            }}
            scale={s.scale}
          >
            <ProductModel model={s.model} palette={s.palette} smoke={i !== 0} />
          </group>
          {i === 0 && (
            <>
              {/* The signature smoke column the camera climbs: a silky ribbon plus a wider, softer body of curls. */}
              <Smoke
                position={[0, 0.575, 0]}
                height={5.2}
                spread={1.35}
                count={900}
                size={280}
                opacity={0.12}
                color={smokeColor}
                ribbonWidth={0.045}
                ribbonOpacity={0.5}
                wind={0.1}
              />
              {!low && (
              <Smoke
                position={[0, 0.6, 0]}
                height={4.4}
                spread={1.9}
                count={420}
                size={360}
                opacity={0.06}
                color={smokeColor}
                ribbon={false}
                wind={0.16}
                seed={7}
              />
              )}
              <EmberGlow light={light} />
              {/* Embers lifting off the tips and drifting up the column. */}
              {!still && <Sparkles count={low ? 18 : 42} scale={[1.1, 4.6, 1.1]} position={[0, 2.6, 0]} size={2.8} speed={0.45} noise={0.6} color="#ffad66" opacity={0.85} />}
            </>
          )}
        </group>
      ))}
    </>
  );
}

function Scene({ progress, smokeColor, still, low, light }: { progress: HeroProgress; smokeColor: string; still: boolean; low: boolean; light: boolean }) {
  return (
    <>
      <Rig progress={progress} still={still} />
      <StudioLights shadows={false} light={light} />
      <Stations smokeColor={smokeColor} light={light} />
      {!still && <Sparkles count={low ? 30 : 70} scale={[SPACING * 4, 4, 3]} size={2.2} speed={0.22} color="#ff8a3d" opacity={0.55} position={[SPACING * 1.5, 1, -0.8]} />}
      {/* MSAA on capable devices: clean model edges (the canvas itself can't antialias under post-processing). */}
      <EffectComposer multisampling={low ? 0 : 4}>
        <Bloom intensity={light ? 0.55 : 0.85} luminanceThreshold={0.8} luminanceSmoothing={0.2} mipmapBlur radius={0.7} />
        <Noise opacity={light ? 0.02 : 0.03} />
        {/* A heavy vignette muddies the ivory theme; keep it gentle there. */}
        <Vignette offset={0.25} darkness={light ? 0.3 : 0.75} />
      </EffectComposer>
    </>
  );
}

/**
 * Cinematic hero: the camera climbs the incense smoke, then glides on to coil → perfume mist → oud as the page scrolls.
 * Pauses off-screen / in background tabs; `still` (reduced motion) renders one static pose on demand.
 */
export default function HeroScene({
  progress,
  smokeColor = "#c9b79c",
  still = false,
  light = false,
}: {
  progress: HeroProgress;
  smokeColor?: string;
  still?: boolean;
  /** Light ("ivoire") theme: models switch to their ivory look; softer vignette and bloom. */
  light?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(wrap, "0px");
  const { low, dpr, armed, monitor } = useAdaptiveQuality();
  // `light` reaches every model (smoke, mist, ash) so they pick their ivory-theme look.
  const mode = useMemo(() => ({ still, low, light }), [still, low, light]);
  return (
    <div ref={wrap} className="h-full w-full">
      <Canvas
        dpr={dpr}
        frameloop={still ? "demand" : onScreen ? "always" : "never"}
        camera={{ position: [-1.05, 0.3, 4.2], fov: 32 }}
        gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}
      >
        <SceneModeProvider value={mode}>
          {!still && armed && <PerformanceMonitor {...monitor} />}
          <Suspense fallback={null}>
            <Scene progress={progress} smokeColor={smokeColor} still={still} low={low} light={light} />
            {/* Compile every station's shaders (and the perfume's transmission pass) up front: otherwise the
                first frame each object scrolls into view stalls for hundreds of ms on a real GPU. */}
            <Preload all />
          </Suspense>
        </SceneModeProvider>
      </Canvas>
    </div>
  );
}
