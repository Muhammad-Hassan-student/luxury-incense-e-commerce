"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const vertex = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    // Sway the tip more than the base.
    float sway = sin(uTime * 3.1) * 0.03 + sin(uTime * 7.3) * 0.012;
    p.x += sway * uv.y * uv.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    vec2 uv = vUv - vec2(0.5, 0.0);
    // Teardrop: wide at the bottom, pinched at the top.
    float w = mix(0.36, 0.02, pow(vUv.y, 0.9));
    float flick = 0.92 + 0.08 * sin(uTime * 23.0) * sin(uTime * 13.0);
    float d = abs(uv.x) / w;
    float body = smoothstep(1.0, 0.2, d) * smoothstep(1.0, 0.75, vUv.y) * smoothstep(0.0, 0.12, vUv.y);
    vec3 core = vec3(1.0, 0.97, 0.86);
    vec3 mid = vec3(1.0, 0.62, 0.22);
    vec3 edge = vec3(0.89, 0.34, 0.17);
    vec3 col = mix(edge, mid, smoothstep(0.9, 0.4, d));
    col = mix(col, core, smoothstep(0.45, 0.0, d) * smoothstep(0.7, 0.2, vUv.y));
    float blue = smoothstep(0.12, 0.0, vUv.y) * smoothstep(0.8, 0.0, d);
    col = mix(col, vec3(0.35, 0.45, 1.0), blue * 0.5);
    gl_FragColor = vec4(col * 1.6, body * flick);
  }
`;

/** Billboarded candle flame with a flickering warm point light. */
export function Flame({ position = [0, 0, 0] as [number, number, number], scale = 1, intensity = 2.4 }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const light = useRef<THREE.PointLight>(null);
  const group = useRef<THREE.Group>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (mat.current) mat.current.uniforms.uTime.value = t;
    if (light.current) light.current.intensity = intensity * (0.85 + Math.sin(t * 17) * 0.06 + Math.sin(t * 7.7) * 0.09);
    // Face the camera around Y only, so the flame stays upright.
    if (group.current) group.current.rotation.y = Math.atan2(state.camera.position.x - group.current.position.x, state.camera.position.z - group.current.position.z);
  });

  return (
    <group ref={group} position={position} scale={scale}>
      <mesh position={[0, 0.11, 0]}>
        <planeGeometry args={[0.12, 0.26]} />
        <shaderMaterial ref={mat} vertexShader={vertex} fragmentShader={fragment} uniforms={uniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <pointLight ref={light} position={[0, 0.12, 0]} color="#ff9a4a" intensity={intensity} distance={4} decay={2} />
    </group>
  );
}
