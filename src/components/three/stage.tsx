"use client";

import { Environment, Lightformer } from "@react-three/drei";

/** Studio lighting built from light-formers, so nothing is fetched from a CDN. */
export function StudioLights({ warm = "#ffd8a8" }: { warm?: string }) {
  return (
    <>
      <ambientLight intensity={0.15} />
      <spotLight position={[3, 5, 3]} angle={0.4} penumbra={1} intensity={30} color={warm} castShadow shadow-mapSize={[1024, 1024]} />
      <spotLight position={[-4, 2, -2]} angle={0.5} penumbra={1} intensity={12} color="#8fa3c8" />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.5} color={warm} position={[0, 3, -4]} scale={[6, 2, 1]} />
        <Lightformer form="rect" intensity={1.2} color="#ffffff" position={[-4, 1, 1]} rotation-y={Math.PI / 2} scale={[4, 3, 1]} />
        <Lightformer form="ring" intensity={1.5} color={warm} position={[4, 2, 2]} rotation-y={-Math.PI / 2} scale={2} />
      </Environment>
    </>
  );
}
