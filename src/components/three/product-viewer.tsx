"use client";

import {
  Suspense,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useTheme } from "@/lib/use-client";
import {
  AdaptiveDpr,
  ContactShadows,
  Float,
  OrbitControls,
  PerformanceMonitor,
} from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import type { Model3D } from "@/generated/prisma/enums";
import { ProductModel } from "./models";
import { StudioLights } from "./stage";
import { SceneModeProvider, useSceneMode } from "./shared";
import { startsLow, useOnScreen } from "./perf";

type View = {
  position: [number, number, number];
  target: [number, number, number];
  minPolar: number;
  maxPolar: number;
};
const defaultView: View = {
  position: [0, 0.45, 3.6],
  target: [0, 0, 0],
  minPolar: Math.PI / 3,
  maxPolar: Math.PI / 1.9,
};
/** Some pieces read best from above (a coil lies flat) or need room for their effect (perfume mist). */
const views: Partial<Record<Model3D, View>> = {
  COIL: { position: [0, 2.15, 3.35], target: [0, -0.28, 0], minPolar: 0.55, maxPolar: 1.15 },
  OUD: { position: [0, 1.25, 3.2], target: [0, -0.3, 0], minPolar: 0.8, maxPolar: Math.PI / 2.1 },
  PERFUME: {
    position: [0, 0.5, 3.9],
    target: [0.12, 0.02, 0],
    minPolar: Math.PI / 3,
    maxPolar: Math.PI / 1.9,
  },
};

/**
 * Drag-to-turn product viewer. Loaded client-side only (see ProductViewerLazy).
 * Pauses while off-screen or in a background tab; `still` renders one static pose on demand (reduced motion).
 */
export default function ProductViewer({
  model,
  palette,
  interactive = true,
  still = false,
}: {
  model: Model3D;
  palette: string[];
  interactive?: boolean;
  still?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const onScreen = useOnScreen(wrap);
  const [low, setLow] = useState(startsLow);
  const [dpr, setDpr] = useState(() => (startsLow() ? 1 : 1.5));
  // Theme-aware: the ivoire page needs brighter fill, darker smoke, no vignette and a lighter shadow.
  const light = useTheme() === "ivoire";
  const mode = useMemo(() => ({ still, low, light }), [still, low, light]);
  const hover = useRef(false);
  const [shown, setShown] = useState(false);
  const view = views[model] ?? defaultView;

  const camera = useMemo(() => ({ position: view.position, fov: 30 }), [view]);

  return (
    <div
      ref={wrap}
      className="h-full w-full transition-opacity duration-1000 ease-out"
      style={{ opacity: shown ? 1 : 0 }}
      onPointerEnter={() => {
        hover.current = true;
      }}
      onPointerLeave={() => {
        hover.current = false;
      }}
    >
      <Canvas
        onCreated={() => setShown(true)}
        shadows={!low}
        dpr={dpr}
        frameloop={still ? "demand" : onScreen ? "always" : "never"}
        camera={camera}
        gl={{
          antialias: !low,
          alpha: true,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: light ? 1.18 : 1,
        }}
        className="touch-pan-y!"
      >
        <SceneModeProvider value={mode}>
          {!still && (
            <PerformanceMonitor
              onDecline={() => {
                setLow(true);
                setDpr(1);
              }}
              onIncline={() => setDpr(Math.min(low ? 1.25 : 1.75, window.devicePixelRatio))}
              flipflops={3}
              onFallback={() => setLow(true)}
            />
          )}
          <AdaptiveDpr pixelated={false} />
          <Suspense fallback={null}>
            <StudioLights shadows={!low} light={light} />
            <Float
              speed={still ? 0 : 1.2}
              rotationIntensity={still ? 0 : 0.12}
              floatIntensity={still ? 0 : 0.2}
            >
              <Presenter hover={hover}>
                <ProductModel model={model} palette={palette} />
              </Presenter>
            </Float>
            <ContactShadows
              position={[0, -0.62, 0]}
              opacity={light ? 0.38 : 0.55}
              color={light ? "#4a3626" : "#000000"}
              scale={4}
              blur={2.6}
              far={1.4}
              resolution={low ? 256 : 512}
              frames={still || low ? 1 : Infinity}
            />
            <EffectComposer multisampling={0}>
              <Bloom
                intensity={light ? 0.4 : 0.75}
                luminanceThreshold={light ? 0.92 : 0.82}
                luminanceSmoothing={0.22}
                mipmapBlur
                radius={0.7}
              />
              <Vignette offset={0.3} darkness={light ? 0 : 0.55} />
            </EffectComposer>
          </Suspense>
          {!interactive && <LookAt target={view.target} />}
          {interactive && (
            <OrbitControls
              target={view.target}
              enablePan={false}
              enableZoom={false}
              autoRotate={!still}
              autoRotateSpeed={0.5}
              minPolarAngle={view.minPolar}
              maxPolarAngle={view.maxPolar}
              enableDamping
              dampingFactor={0.06}
            />
          )}
        </SceneModeProvider>
      </Canvas>
    </div>
  );
}

function LookAt({ target }: { target: [number, number, number] }) {
  const camera = useThree((s) => s.camera);
  useLayoutEffect(() => camera.lookAt(...target), [camera, target]);
  return null;
}

const ENTRANCE = 1.4; // seconds

/**
 * Entrance (rises into place and settles) and a gentle turn toward the pointer while hovered.
 * Reduced motion: placed immediately, no hover reaction.
 */
function Presenter({ hover, children }: { hover: RefObject<boolean>; children: ReactNode }) {
  const { still } = useSceneMode();
  const group = useRef<THREE.Group>(null);
  const start = useRef(-1);
  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    if (still) {
      g.position.y = 0;
      g.scale.setScalar(1);
      return;
    }
    if (start.current < 0) start.current = state.clock.elapsedTime;
    const p = Math.min(1, (state.clock.elapsedTime - start.current) / ENTRANCE);
    const e = 1 - Math.pow(1 - p, 3);
    g.position.y = -0.28 * (1 - e);
    g.scale.setScalar(0.9 + 0.1 * e);
    const k = 1 - Math.exp(-delta * 3);
    const tx = hover.current ? state.pointer.x * 0.32 : 0;
    const ty = hover.current ? -state.pointer.y * 0.08 : 0;
    g.rotation.y += (tx - g.rotation.y) * k;
    g.rotation.x += (ty - g.rotation.x) * k;
  });
  return <group ref={group}>{children}</group>;
}
