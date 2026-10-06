"use client";

import { Suspense, useRef, useState, type RefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { AdaptiveDpr, PerformanceMonitor, Sparkles } from "@react-three/drei";
import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { ProductModel } from "@/components/three/models";
import { Smoke } from "@/components/three/smoke";
import { StudioLights } from "@/components/three/stage";

export type HeroProgress = RefObject<{ scroll: number; pointerX: number; pointerY: number }>;

function Rig({ progress }: { progress: HeroProgress }) {
  const target = useRef(new THREE.Vector3());
  useFrame((state, delta) => {
    const p = progress.current;
    // Scroll: rise up the smoke column and push in. Pointer: subtle parallax.
    const s = p.scroll;
    const desired = new THREE.Vector3(0.6 + p.pointerX * 0.25, 0.3 + s * 1.6 + p.pointerY * 0.15, 4.2 - s * 1.4);
    state.camera.position.lerp(desired, 1 - Math.exp(-delta * 3));
    target.current.lerp(new THREE.Vector3(0.6, 0.35 + s * 1.8, 0), 1 - Math.exp(-delta * 3));
    state.camera.lookAt(target.current);
  });
  return null;
}

function Scene({ progress, smokeColor }: { progress: HeroProgress; smokeColor: string }) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.05;
  });
  return (
    <>
      <Rig progress={progress} />
      <StudioLights />
      <group ref={group} position={[1.1, -0.2, 0]}>
        <ProductModel model="INCENSE" palette={["#3A2A1E", "#C8A46A"]} smoke={false} />
      </group>
      {/* The hero smoke column: denser and taller than the product viewers. */}
      <Smoke position={[1.1, 0.55, 0]} height={4.2} spread={1.25} count={700} size={260} opacity={0.11} color={smokeColor} />
      <Sparkles count={60} scale={[6, 4, 3]} size={2.2} speed={0.25} color="#ff8a3d" opacity={0.6} position={[0.6, 1, -0.5]} />
      <EffectComposer multisampling={0}>
        <Bloom intensity={0.9} luminanceThreshold={0.8} mipmapBlur />
        <Noise opacity={0.035} />
        <Vignette offset={0.25} darkness={0.75} />
      </EffectComposer>
    </>
  );
}

export default function HeroScene({ progress, smokeColor = "#c9b79c" }: { progress: HeroProgress; smokeColor?: string }) {
  const [dpr, setDpr] = useState(1.5);
  return (
    <Canvas dpr={dpr} camera={{ position: [0.6, 0.3, 4.2], fov: 32 }} gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}>
      <PerformanceMonitor onDecline={() => setDpr(1)} />
      <AdaptiveDpr pixelated={false} />
      <Suspense fallback={null}>
        <Scene progress={progress} smokeColor={smokeColor} />
      </Suspense>
    </Canvas>
  );
}
