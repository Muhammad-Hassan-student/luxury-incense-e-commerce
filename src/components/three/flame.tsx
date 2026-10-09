"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Glow, glslNoise, sceneTime, uniformsOf, useDispose, useSceneMode } from "./shared";

const vertex = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  ${glslNoise}
  void main() {
    vUv = uv;
    vec3 p = position;
    // The tip dances more than the base; slow drift + quick flutter.
    float sway = (mo_noise(vec3(uTime * 1.3, 0.0, 0.0)) - 0.5) * 0.06 + sin(uTime * 9.1) * 0.006;
    p.x += sway * uv.y * uv.y;
    // Breathing height.
    p.y *= 0.94 + 0.08 * mo_noise(vec3(0.0, uTime * 2.2, 3.0));
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += p.xy * length(modelViewMatrix[0].xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  ${glslNoise}
  void main() {
    vec2 uv = vUv - vec2(0.5, 0.0);
    // Teardrop: round belly, pinched flickering tip.
    float y = vUv.y;
    float w = mix(0.3, 0.015, pow(y, 0.8)) * (0.9 + 0.2 * smoothstep(0.0, 0.25, y));
    float wobble = (mo_noise(vec3(y * 4.0 - uTime * 6.0, uTime * 2.0, 1.0)) - 0.5) * 0.06 * y;
    float d = abs(uv.x + wobble) / w;
    float body = smoothstep(1.0, 0.25, d) * smoothstep(0.98, 0.7, y) * smoothstep(0.0, 0.1, y);
    float flick = 0.9 + 0.1 * mo_noise(vec3(uTime * 14.0, 2.0, 0.0));
    vec3 core = vec3(1.0, 0.97, 0.88);
    vec3 mid = vec3(1.0, 0.66, 0.26);
    vec3 edge = vec3(0.93, 0.36, 0.14);
    vec3 col = mix(edge, mid, smoothstep(0.95, 0.45, d));
    col = mix(col, core, smoothstep(0.5, 0.0, d) * smoothstep(0.75, 0.15, y));
    // Blue root, translucent.
    float blue = smoothstep(0.16, 0.0, y) * smoothstep(0.9, 0.0, d);
    col = mix(col, vec3(0.3, 0.42, 1.0), blue * 0.6);
    float a = body * flick * (1.0 - blue * 0.4);
    gl_FragColor = vec4(col * 1.8 * a, a);
  }
`;

/** Camera-facing candle flame with a flickering warm light, halo and a gently moving light source. */
export function Flame({
  position = [0, 0, 0] as [number, number, number],
  scale = 1,
  intensity = 2.4,
}) {
  const mode = useSceneMode();
  const light = useRef<THREE.PointLight>(null);
  const glow = useRef<THREE.Mesh>(null);
  const flame = useRef<THREE.Mesh>(null);
  const material = useDispose(
    useMemo(
      () =>
        new THREE.ShaderMaterial({
          vertexShader: vertex,
          fragmentShader: fragment,
          uniforms: { uTime: { value: 0 } },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      [],
    ),
  );
  const geometry = useDispose(
    useMemo(() => new THREE.PlaneGeometry(0.11, 0.26).translate(0, 0.13, 0), []),
  );

  useFrame((state) => {
    const t = sceneTime(state.clock, mode, 3.3);
    const u = uniformsOf(flame.current);
    if (u) u.uTime.value = t;
    const f = 0.86 + Math.sin(t * 17) * 0.05 + Math.sin(t * 7.7) * 0.07 + Math.sin(t * 2.3) * 0.04;
    if (light.current) {
      light.current.intensity = intensity * f;
      // The light source wanders with the flame so the spill on the wax shimmers.
      light.current.position.x = Math.sin(t * 1.3) * 0.012;
    }
    if (glow.current) glow.current.scale.setScalar(0.9 + f * 0.15);
  });

  return (
    <group position={position} scale={scale}>
      <Glow glowRef={glow} position={[0, 0.1, 0]} size={0.5} color="#ff9440" intensity={0.55} />
      <mesh
        ref={flame}
        geometry={geometry}
        material={material}
        frustumCulled={false}
        renderOrder={6}
      />
      <pointLight
        ref={light}
        position={[0, 0.12, 0]}
        color="#ff9a4a"
        intensity={intensity}
        distance={4}
        decay={2}
      />
    </group>
  );
}
