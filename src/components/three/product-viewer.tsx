"use client";

import { Suspense, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr, ContactShadows, Float, OrbitControls, PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import type { Model3D } from "@/generated/prisma/enums";
import { ProductModel } from "./models";
import { StudioLights } from "./stage";

/** Drag-to-turn product viewer. Loaded client-side only (see ProductViewerLazy). */
export default function ProductViewer({ model, palette, interactive = true }: { model: Model3D; palette: string[]; interactive?: boolean }) {
  const [dpr, setDpr] = useState(1.5);
  return (
    <Canvas
      shadows
      dpr={dpr}
      camera={{ position: [0, 0.45, 3.6], fov: 30 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      className="!touch-pan-y"
    >
      <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(Math.min(2, window.devicePixelRatio))} />
      <AdaptiveDpr pixelated={false} />
      <Suspense fallback={null}>
        <StudioLights />
        <Float speed={1.2} rotationIntensity={0.15} floatIntensity={0.25}>
          <ProductModel model={model} palette={palette} />
        </Float>
        <ContactShadows position={[0, -0.62, 0]} opacity={0.55} scale={4} blur={2.6} far={1.4} />
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.7} luminanceThreshold={0.85} luminanceSmoothing={0.2} mipmapBlur />
          <Vignette offset={0.3} darkness={0.55} />
        </EffectComposer>
      </Suspense>
      {interactive && (
        <OrbitControls
          enablePan={false}
          enableZoom={false}
          autoRotate
          autoRotateSpeed={0.6}
          minPolarAngle={Math.PI / 3}
          maxPolarAngle={Math.PI / 1.9}
          enableDamping
          dampingFactor={0.06}
        />
      )}
    </Canvas>
  );
}
