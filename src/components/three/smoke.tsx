"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { seeded } from "@/lib/use-client";

const vertex = /* glsl */ `
  uniform float uTime;
  uniform float uHeight;
  uniform float uSpread;
  uniform float uSize;
  uniform float uPixelRatio;
  attribute float aSeed;
  varying float vAlpha;
  varying float vSeed;

  // Cheap 3D value noise
  float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float noise(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }

  void main() {
    float life = fract(uTime * (0.06 + aSeed * 0.04) + aSeed);
    float y = life * uHeight;
    // A thin column that unravels into curls as it rises.
    float curl = pow(life, 1.6) * uSpread;
    float n1 = noise(vec3(y * 1.4, uTime * 0.25, aSeed * 10.0)) - 0.5;
    float n2 = noise(vec3(aSeed * 10.0, y * 1.4, uTime * 0.25)) - 0.5;
    vec3 pos = position + vec3(n1 * curl * 2.6 + sin(y * 2.5 + uTime * 0.7 + aSeed * 6.0) * 0.09 * life, y, n2 * curl * 2.6);

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.25 + life * 1.6) * uPixelRatio * (1.0 / -mv.z);
    vAlpha = smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.55, 1.0, life));
    vSeed = aSeed;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  varying float vSeed;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float soft = smoothstep(0.5, 0.0, d);
    float wisp = 0.6 + 0.4 * sin((uv.x + uv.y + vSeed) * 12.0);
    gl_FragColor = vec4(uColor, soft * soft * wisp * vAlpha * uOpacity);
  }
`;

export function Smoke({
  count = 420,
  height = 2.4,
  spread = 0.35,
  size = 90,
  color = "#c9b79c",
  opacity = 0.22,
  position = [0, 0, 0] as [number, number, number],
}) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const rand = seeded(count * 7919);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rand() - 0.5) * 0.015;
      pos[i * 3 + 2] = (rand() - 0.5) * 0.015;
      seeds[i] = rand();
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    return g;
  }, [count]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uHeight: { value: height },
      uSpread: { value: spread },
      uSize: { value: size },
      uPixelRatio: { value: 1 },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useFrame((state) => {
    if (!material.current) return;
    const u = material.current.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uPixelRatio.value = state.gl.getPixelRatio();
    u.uColor.value.set(color);
    u.uOpacity.value = opacity;
  });

  return (
    <points geometry={geometry} position={position} frustumCulled={false}>
      <shaderMaterial
        ref={material}
        vertexShader={vertex}
        fragmentShader={fragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </points>
  );
}
