"use client";

import { Environment, Lightformer } from "@react-three/drei";

/**
 * Studio lighting built from light-formers, so nothing is fetched from a CDN.
 * Warm key, cool fill, a warm rim from behind for silhouettes, and a soft overhead strip that gives
 * glass and gold long, clean highlights.
 */
export function StudioLights({
  warm = "#ffd8a8",
  shadows = true,
  light = false,
}: {
  warm?: string;
  shadows?: boolean;
  /** Ivoire (light) page: lift the fill and reflections so pieces don't read flat and grey. */
  light?: boolean;
}) {
  return (
    <>
      <ambientLight intensity={light ? 0.28 : 0.12} />
      {light && <hemisphereLight args={["#fff3e0", "#6b5440", 0.8]} />}
      <spotLight
        position={[3, 5, 3]}
        angle={0.4}
        penumbra={1}
        intensity={30}
        color={warm}
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
      />
      <spotLight position={[-4, 2, -2]} angle={0.5} penumbra={1} intensity={12} color="#8fa3c8" />
      <spotLight position={[0, 2.5, -4]} angle={0.6} penumbra={1} intensity={14} color={warm} />
      <Environment resolution={256} frames={1} environmentIntensity={light ? 1.35 : 1}>
        <Lightformer
          form="rect"
          intensity={2.5}
          color={warm}
          position={[0, 3, -4]}
          scale={[6, 2, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.2}
          color="#ffffff"
          position={[-4, 1, 1]}
          rotation-y={Math.PI / 2}
          scale={[4, 3, 1]}
        />
        <Lightformer
          form="ring"
          intensity={1.5}
          color={warm}
          position={[4, 2, 2]}
          rotation-y={-Math.PI / 2}
          scale={2}
        />
        <Lightformer
          form="rect"
          intensity={1.6}
          color="#fff4e6"
          position={[0, 5, 0]}
          rotation-x={Math.PI / 2}
          scale={[1.2, 6, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.6}
          color="#c8a46a"
          position={[0, -2, 3]}
          rotation-x={-Math.PI / 4}
          scale={[6, 1, 1]}
        />
      </Environment>
    </>
  );
}
