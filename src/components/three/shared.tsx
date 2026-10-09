"use client";

import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { seeded } from "@/lib/use-client";

/**
 * How a scene should animate.
 * - `still`: prefers-reduced-motion — every model renders one calm, representative pose.
 * - `low`: phone / struggling GPU — fewer particles and cheaper passes.
 */
export type SceneMode = {
  still: boolean;
  low: boolean;
  /** light (ivoire) page background */ light?: boolean;
};
const SceneModeContext = createContext<SceneMode>({ still: false, low: false });
export const SceneModeProvider = SceneModeContext.Provider;
export const useSceneMode = () => useContext(SceneModeContext);

/** Scene time in seconds; frozen at `still` so reduced-motion users get a fixed, flattering pose. */
export function sceneTime(clock: THREE.Clock, mode: SceneMode, still = 7.5) {
  return mode.still ? still : clock.elapsedTime;
}

/** Particle budget for the current quality tier. */
export function useBudget(count: number) {
  const { low } = useSceneMode();
  return Math.max(8, Math.round(low ? count * 0.45 : count));
}

/** Disposes a memoised three.js resource when it is replaced or the component unmounts: `useDispose(useMemo(() => …, [deps]))`. */
export function useDispose<T extends { dispose: () => void }>(value: T): T {
  useEffect(() => () => value.dispose(), [value]);
  return value;
}

export function lathe(points: [number, number][], segments = 96) {
  return new THREE.LatheGeometry(
    points.map(([x, y]) => new THREE.Vector2(x, y)),
    segments,
  );
}

/** Polished gold, shared by holders, collars and trays. */
export function useGold(accent: string, roughness = 0.24) {
  return useDispose(
    useMemo(
      () =>
        new THREE.MeshPhysicalMaterial({
          color: accent,
          metalness: 1,
          roughness,
          clearcoat: 0.35,
          clearcoatRoughness: 0.2,
        }),
      [accent, roughness],
    ),
  );
}

/** Engraved brass (or, with metalness 0, carved wood): concentric bands and petal arabesques cut into the metal (rougher, darker grooves). */
export function useEngravedBrass(accent: string, scale = 1, metalness = 1, roughness = 0.26) {
  return useDispose(
    useMemo(() => {
      const m = new THREE.MeshStandardMaterial({ color: accent, metalness, roughness });
      m.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec3 vP;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvP = position;");
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            `#include <common>
          varying vec3 vP;
          float moEngrave(vec2 p) {
            float r = length(p);
            float a = atan(p.y, p.x);
            float bands = smoothstep(0.006, 0.0, abs(fract(r * 9.0) - 0.5) - 0.47);
            float petal = abs(sin(a * 8.0)) * 0.09 + 0.12;
            float rose = smoothstep(0.008, 0.0, abs(r - petal - 0.18) - 0.004) * step(r, 0.42);
            float vine = smoothstep(0.01, 0.0, abs(fract(r * 3.0 + sin(a * 16.0) * 0.08) - 0.5) - 0.48) * step(0.45, r);
            return clamp(bands * step(0.62, r) + rose + vine, 0.0, 1.0);
          }`,
          )
          .replace(
            "#include <color_fragment>",
            `#include <color_fragment>
          float groove = moEngrave(vP.xz / ${scale.toFixed(3)});
          diffuseColor.rgb *= 1.0 - groove * 0.55;`,
          )
          .replace(
            "#include <roughnessmap_fragment>",
            `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.6, groove);`,
          );
      };
      m.customProgramCacheKey = () => `mo-engraved-${scale}`;
      return m;
    }, [accent, scale, metalness, roughness]),
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Procedural textures (generated once per page, never downloaded)                                */
/* ---------------------------------------------------------------------------------------------- */

let grainTexture: THREE.DataTexture | undefined;
/** Tileable fine grain used as a bump/roughness map for masala, wax, ash and ceramics. */
export function getGrainTexture() {
  if (grainTexture) return grainTexture;
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  const rand = seeded(1337);
  // Two octaves of value noise on a wrapped lattice so the texture tiles.
  const lattice = (cells: number) => {
    const g = Array.from({ length: cells * cells }, () => rand());
    return (x: number, y: number) => {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) =>
        g[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const coarse = lattice(16);
  const fine = lattice(64);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = coarse(x, y) * 0.45 + fine(x, y) * 0.4 + rand() * 0.15;
      const c = Math.round(v * 255);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = c;
      data[i + 3] = 255;
    }
  }
  grainTexture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  grainTexture.wrapS = grainTexture.wrapT = THREE.RepeatWrapping;
  grainTexture.magFilter = THREE.LinearFilter;
  grainTexture.minFilter = THREE.LinearMipmapLinearFilter;
  grainTexture.generateMipmaps = true;
  grainTexture.needsUpdate = true;
  return grainTexture;
}

/** A grain texture with its own repeat (textures share the image, so cloning is cheap). */
export function useGrain(repeatX: number, repeatY = repeatX) {
  return useDispose(
    useMemo(() => {
      const t = getGrainTexture().clone();
      t.repeat.set(repeatX, repeatY);
      t.needsUpdate = true;
      return t;
    }, [repeatX, repeatY]),
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Glass on a transparent canvas                                                                   */
/* ---------------------------------------------------------------------------------------------- */

/**
 * three.js clears the transmission buffer to white @ 50% alpha when the canvas is transparent, so glass
 * over "nothing" turns milky. Treat those cleared texels as empty instead: the page shows through the
 * glass (with a faint smoky tint), while objects behind or inside it are still refracted.
 */
export function clearGlass<T extends THREE.MeshPhysicalMaterial>(m: T, tint = 0.1): T {
  const previous = m.onBeforeCompile.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    previous(shader, renderer);
    const wrapper = `
      vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
        vec4 s = getTransmissionSampleRaw( fragCoord, roughness, ior );
        float empty = clamp( ( 1.0 - s.a ) * 2.0, 0.0, 1.0 );
        return vec4( mix( s.rgb, vec3( 0.0 ), empty ), mix( s.a, ${tint.toFixed(3)}, empty ) );
      }
      vec4 getIBLVolumeRefraction(`;
    const chunk = THREE.ShaderChunk.transmission_pars_fragment
      .replace("vec4 getTransmissionSample(", "vec4 getTransmissionSampleRaw(")
      .replace("vec4 getIBLVolumeRefraction(", wrapper);
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <transmission_pars_fragment>",
      chunk,
    );
  };
  const key = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => `${key()}-clear-glass`;
  return m;
}

/* ---------------------------------------------------------------------------------------------- */
/* GLSL helpers                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

export const glslNoise = /* glsl */ `
  float mo_hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float mo_noise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(mo_hash(i), mo_hash(i + vec3(1,0,0)), f.x), mix(mo_hash(i + vec3(0,1,0)), mo_hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(mo_hash(i + vec3(0,0,1)), mo_hash(i + vec3(1,0,1)), f.x), mix(mo_hash(i + vec3(0,1,1)), mo_hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float mo_fbm(vec3 p) { return mo_noise(p) * 0.55 + mo_noise(p * 2.03 + 7.1) * 0.3 + mo_noise(p * 4.1 + 3.7) * 0.15; }
`;

/* ---------------------------------------------------------------------------------------------- */
/* Glow sprite                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

const glowVertex = /* glsl */ `
  uniform float uSize;
  varying vec2 vUv;
  void main() {
    vUv = uv - 0.5;
    // Camera-facing quad of a fixed world size.
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += position.xy * uSize * length(modelViewMatrix[0].xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const glowFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    float d = length(vUv) * 2.0;
    float core = exp(-d * d * 18.0);
    float halo = exp(-d * d * 3.2) * 0.35;
    float a = (core + halo) * smoothstep(1.0, 0.7, d);
    gl_FragColor = vec4(uColor * uIntensity * a, a);
  }
`;

/** Additive, camera-facing glow (ember halos, coal heat, flame bloom). Drive intensity via the returned ref. */
export function Glow({
  position,
  size = 0.12,
  color = "#ff7a2a",
  intensity = 1.5,
  glowRef,
}: {
  position?: [number, number, number];
  size?: number;
  color?: string;
  intensity?: number;
  glowRef?: React.Ref<THREE.Mesh>;
}) {
  const material = useDispose(
    useMemo(
      () =>
        new THREE.ShaderMaterial({
          vertexShader: glowVertex,
          fragmentShader: glowFragment,
          uniforms: {
            uSize: { value: size },
            uColor: { value: new THREE.Color(color) },
            uIntensity: { value: intensity },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      [size, color, intensity],
    ),
  );
  return (
    <mesh
      ref={glowRef}
      position={position}
      material={material}
      frustumCulled={false}
      renderOrder={5}
    >
      <planeGeometry args={[1, 1]} />
    </mesh>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Sparks                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

const sparkVertex = /* glsl */ `
  uniform float uTime;
  uniform vec3 uOrigin;
  uniform float uPixelRatio;
  uniform float uRate;
  attribute float aSeed;
  varying float vA;
  void main() {
    float period = 1.6 + aSeed * 2.8;
    float life = fract(uTime / period + aSeed * 7.13);
    float on = step(life, uRate);       // most sparks are dormant; a few fly at a time
    float t = life / max(uRate, 0.001);
    vec3 dir = normalize(vec3(sin(aSeed * 91.0), 1.6 + fract(aSeed * 13.0), cos(aSeed * 57.0)));
    vec3 p = uOrigin + dir * t * 0.09 + vec3(0.0, t * t * 0.08, 0.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (2.2 + aSeed * 1.6) * uPixelRatio * (1.0 - t * 0.6) * on;
    vA = on * (1.0 - t) * (0.6 + 0.4 * sin(uTime * 40.0 + aSeed * 50.0));
  }
`;
const sparkFragment = /* glsl */ `
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vA;
    gl_FragColor = vec4(vec3(1.0, 0.62, 0.25) * 3.0 * a, a);
  }
`;

/** A few tiny sparks leaping from a (possibly moving) ember. */
export function Sparks({
  origin,
  count = 10,
  rate = 0.22,
}: {
  origin: React.RefObject<THREE.Vector3 | null> | [number, number, number];
  count?: number;
  rate?: number;
}) {
  const mode = useSceneMode();
  const n = useBudget(count);
  const geometry = useDispose(
    useMemo(() => {
      const g = new THREE.BufferGeometry();
      const seeds = new Float32Array(n);
      const rand = seeded(n * 31 + 7);
      for (let i = 0; i < n; i++) seeds[i] = rand();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
      return g;
    }, [n]),
  );
  const material = useDispose(
    useMemo(
      () =>
        new THREE.ShaderMaterial({
          vertexShader: sparkVertex,
          fragmentShader: sparkFragment,
          uniforms: {
            uTime: { value: 0 },
            uOrigin: { value: new THREE.Vector3() },
            uPixelRatio: { value: 1 },
            uRate: { value: rate },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      [rate],
    ),
  );
  const points = useRef<THREE.Points>(null);
  useFrame((state) => {
    const u = uniformsOf(points.current);
    if (!u) return;
    u.uTime.value = sceneTime(state.clock, mode);
    u.uPixelRatio.value = state.gl.getPixelRatio();
    if (Array.isArray(origin)) u.uOrigin.value.set(origin[0], origin[1], origin[2]);
    else if (origin.current) u.uOrigin.value.copy(origin.current);
  });
  if (mode.still) return null;
  return (
    <points
      ref={points}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      renderOrder={6}
    />
  );
}

/** Shared ref to a moving point (ember tip, nozzle…) that effects can follow without re-rendering. */
export function usePoint(x = 0, y = 0, z = 0) {
  return useRef(new THREE.Vector3(x, y, z));
}

/**
 * Uniforms of an object's material, for the frame loop. Shader materials expose `uniforms`; patched
 * built-in materials keep their extra uniforms in `userData.u`. Reaching them through an object ref keeps
 * render-time values immutable (React compiler rules) while the render loop updates the GPU state.
 */
export function uniformsOf(
  object: THREE.Object3D | null | undefined,
): Record<string, THREE.IUniform> | undefined {
  const material = (object as THREE.Mesh | null | undefined)?.material;
  if (!material || Array.isArray(material)) return undefined;
  return material instanceof THREE.ShaderMaterial
    ? material.uniforms
    : (material.userData.u as Record<string, THREE.IUniform> | undefined);
}

const fleckVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uFall;
  attribute float aSeed;
  varying float vA;
  void main() {
    float period = 3.5 + aSeed * 3.0;
    float life = fract(uTime / period + aSeed * 5.31);
    // Flakes drop slowly, tumbling sideways like ash.
    vec3 p = position;
    p.y -= life * life * uFall;
    p.x += sin(life * 6.0 + aSeed * 40.0) * 0.025 * life + (aSeed - 0.5) * 0.05 * life;
    p.z += cos(life * 5.0 + aSeed * 23.0) * 0.02 * life;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.6 + aSeed * 1.8) * uPixelRatio * (3.0 / -mv.z);
    vA = smoothstep(0.0, 0.05, life) * (1.0 - smoothstep(0.85, 1.0, life));
  }
`;
const fleckFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    gl_FragColor = vec4(uColor, smoothstep(0.5, 0.2, d) * vA * 0.9);
  }
`;

/** A few pale ash flecks that break off a burning tip and drift down (incense, dhoop). */
export function Flecks({
  origin,
  count = 8,
  fall = 1.1,
}: {
  origin: [number, number, number];
  count?: number;
  fall?: number;
}) {
  const mode = useSceneMode();
  const n = useBudget(count);
  const geometry = useDispose(
    useMemo(() => {
      const g = new THREE.BufferGeometry();
      const rand = seeded(n * 97 + 3);
      const pos = new Float32Array(n * 3);
      const seeds = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        pos.set(
          [origin[0] + (rand() - 0.5) * 0.02, origin[1], origin[2] + (rand() - 0.5) * 0.02],
          i * 3,
        );
        seeds[i] = rand();
      }
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
      return g;
    }, [n, origin]),
  );
  const material = useDispose(
    useMemo(
      () =>
        new THREE.ShaderMaterial({
          vertexShader: fleckVertex,
          fragmentShader: fleckFragment,
          uniforms: {
            uTime: { value: 0 },
            uPixelRatio: { value: 1 },
            uFall: { value: fall },
            uColor: { value: new THREE.Color("#b8b0a4") },
          },
          transparent: true,
          depthWrite: false,
        }),
      [fall],
    ),
  );
  const points = useRef<THREE.Points>(null);
  useFrame((state) => {
    const u = uniformsOf(points.current);
    if (!u) return;
    u.uTime.value = sceneTime(state.clock, mode);
    u.uPixelRatio.value = state.gl.getPixelRatio();
    (u.uColor.value as THREE.Color).set(mode.light ? "#8c8378" : "#b8b0a4");
  });
  if (mode.still) return null;
  return <points ref={points} geometry={geometry} material={material} frustumCulled={false} />;
}
