"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { seeded } from "@/lib/use-client";
import { glslNoise, sceneTime, uniformsOf, useBudget, useDispose, useSceneMode } from "./shared";

/*
 * Smoke is two cheap layers that share one "trail":
 *  - a ribbon: a thin camera-facing strip whose spine meanders upward (the silky thread right above an ember);
 *  - puffs: soft points that unravel into curls higher up.
 * The trail is a short history of where the source was, so smoke from a moving ember (a mosquito coil)
 * stays where it was released instead of being dragged sideways.
 */

const TRAIL = 32;
const TRAIL_STEP = 0.45; // seconds between trail samples → ~14 s of history

const trailGlsl = /* glsl */ `
  uniform vec4 uTrail[${TRAIL}]; // xyz = source, w = emission strength
  uniform float uTrailStep;
  uniform float uTrailPhase; // 0..1: how far we are into the current step
  // uTrail[0] is "now"; uTrail[k >= 1] was sampled (uTrailPhase + k - 1) steps ago.
  vec4 trailAt(float age) {
    float first = uTrailPhase * uTrailStep;
    if (age <= first) return mix(uTrail[0], uTrail[1], age / max(first, 1e-4));
    float f = min((age - first) / uTrailStep + 1.0, ${TRAIL - 1}.0 - 0.001);
    int i = int(floor(f));
    return mix(uTrail[i], uTrail[i + 1], fract(f));
  }
`;

const ribbonVertex = /* glsl */ `
  uniform float uTime;
  uniform float uHeight;
  uniform float uWidth;
  uniform float uRise;
  uniform float uSeed;
  uniform float uWind;
  varying float vV;
  varying float vU;
  varying float vFade;
  varying float vPinch;
  ${glslNoise}
  ${trailGlsl}
  void main() {
    float v = position.y;           // 0 at the ember → 1 at the top
    float u = position.x * 2.0;     // -1..1 across the ribbon
    float y = v * uHeight;
    float age = y / uRise;
    vec4 src = trailAt(age);
    vec3 origin = src.xyz;

    // Travelling meanders that grow with height, plus slow turbulence and a soft breeze.
    float grow = 0.012 + pow(v, 1.45) * 0.42;
    float ph = y * 2.6 - uTime * 0.9 + uSeed;
    vec2 off = vec2(sin(ph) + 0.45 * sin(y * 6.1 - uTime * 1.7 + uSeed * 2.0), cos(ph * 0.83 + 1.3) + 0.4 * cos(y * 5.3 - uTime * 1.3));
    off *= grow * 0.42;
    off += (vec2(mo_fbm(vec3(y * 1.3, uTime * 0.16, uSeed)), mo_fbm(vec3(uSeed, y * 1.3, uTime * 0.16 + 4.0))) - 0.5) * grow * 1.4;
    off.x += uWind * v * v * (0.7 + 0.3 * sin(uTime * 0.21 + uSeed));

    vec3 spine = origin + vec3(off.x, y, off.y);
    // Width pinches and swells like a twisting ribbon.
    float twist = 0.55 + 0.45 * sin(y * 4.3 - uTime * 1.25 + uSeed * 3.0);
    float width = uWidth * (0.22 + pow(v, 0.9) * 3.2) * (0.35 + twist * 0.65);
    vec4 mv = modelViewMatrix * vec4(spine, 1.0);
    mv.x += u * width * 0.5;
    gl_Position = projectionMatrix * mv;

    vV = v;
    vU = u;
    vPinch = 1.0 / (0.35 + twist * 0.65);
    vFade = src.w * smoothstep(0.0, 0.035, v) * (1.0 - smoothstep(0.4, 1.0, v)) * smoothstep(0.2, 1.2, -mv.z);
  }
`;

const ribbonFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uWarm;
  uniform float uOpacity;
  varying float vV;
  varying float vU;
  varying float vFade;
  varying float vPinch;
  ${glslNoise}
  void main() {
    float edge = exp(-vU * vU * 2.4) * smoothstep(1.0, 0.7, abs(vU));
    // Streaks flowing upward give the silky, fibrous look of incense smoke.
    float streak = mo_fbm(vec3(vU * 2.2, vV * 7.0 - uTime * 0.55, 1.7));
    float threads = 0.35 + 0.9 * smoothstep(0.32, 0.78, streak);
    float a = edge * threads * vFade * uOpacity * min(vPinch, 1.8);
    vec3 col = mix(uWarm, uColor, smoothstep(0.0, 0.25, vV));
    gl_FragColor = vec4(col, a);
  }
`;

const puffVertex = /* glsl */ `
  uniform float uTime;
  uniform float uHeight;
  uniform float uSpread;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uWind;
  attribute float aSeed;
  varying float vAlpha;
  varying float vSeed;
  varying float vLife;
  ${glslNoise}
  ${trailGlsl}
  void main() {
    float rate = 0.06 + aSeed * 0.04;
    float life = fract(uTime * rate + aSeed);
    float age = life / rate;
    vec4 src = trailAt(age);
    vec3 origin = src.xyz;
    float y = life * uHeight;
    // Curl-ish turbulence: two decorrelated fbm fields, growing as the column unravels.
    float curl = pow(life, 1.5) * uSpread;
    vec3 q = vec3(y * 1.1, uTime * 0.12, aSeed * 9.0);
    float n1 = mo_fbm(q) - 0.5;
    float n2 = mo_fbm(q.zxy + 5.2) - 0.5;
    vec3 pos = origin + position + vec3(n1 * curl * 2.6 + sin(y * 2.2 + uTime * 0.5 + aSeed * 6.0) * 0.07 * life, y, n2 * curl * 2.6);
    pos.x += uWind * life * life * (0.8 + 0.2 * sin(uTime * 0.21));

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(uSize * (0.45 + life * 1.6) * uPixelRatio * (1.0 / -mv.z), 220.0 * uPixelRatio);
    // Fade in, fade out, and fade very near the lens so nothing pops.
    vAlpha = src.w * smoothstep(0.06, 0.3, life) * (1.0 - smoothstep(0.45, 1.0, life)) * smoothstep(0.3, 1.4, -mv.z);
    vSeed = aSeed;
    vLife = life;
  }
`;

const puffFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uWarm;
  uniform float uOpacity;
  uniform float uTime;
  varying float vAlpha;
  varying float vSeed;
  varying float vLife;
  ${glslNoise}
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float soft = exp(-d * d * 14.0) * smoothstep(0.5, 0.35, d);
    // Rotating noise inside each puff breaks up the round sprite into wisps.
    float a0 = vSeed * 6.283 + uTime * 0.1;
    vec2 r = mat2(cos(a0), -sin(a0), sin(a0), cos(a0)) * uv;
    float wisp = 0.45 + 0.75 * mo_fbm(vec3(r * 4.0, vSeed * 13.0 + vLife * 2.0));
    vec3 col = mix(uWarm, uColor, smoothstep(0.0, 0.3, vLife));
    gl_FragColor = vec4(col, soft * wisp * vAlpha * uOpacity);
  }
`;

type Vec3 = [number, number, number];

export function Smoke({
  count = 420,
  height = 2.4,
  spread = 0.35,
  size = 90,
  color = "#c9b79c",
  warm = "#e8c9a0",
  opacity = 0.22,
  position = [0, 0, 0] as Vec3,
  follow,
  strength,
  ribbon = true,
  ribbonWidth = 0.035,
  ribbonOpacity = 0.5,
  wind = 0.12,
  seed = 1,
}: {
  count?: number;
  height?: number;
  spread?: number;
  size?: number;
  color?: string;
  /** Tint right above the ember */
  warm?: string;
  opacity?: number;
  position?: Vec3;
  /** Optional moving source (in this component's parent space, added to `position`). */
  follow?: React.RefObject<THREE.Vector3 | null>;
  /** Optional 0..1 emission strength (e.g. while an ember is dying), recorded in the trail. */
  strength?: React.RefObject<number>;
  ribbon?: boolean;
  ribbonWidth?: number;
  ribbonOpacity?: number;
  wind?: number;
  seed?: number;
}) {
  const mode = useSceneMode();
  const n = useBudget(count);

  // Trail state lives in the (shared) uniforms; the frame loop reaches it through the points ref.
  const puffs = useRef<THREE.Points>(null);
  const ribbonMesh = useRef<THREE.Mesh>(null);
  const phase = useRef({ acc: 0, frames: 0 });

  // Uniforms shared by both layers; colour/wind are written every frame, so start neutral.
  const shared = useMemo(
    () => ({
      uTime: { value: 0 },
      uTrail: { value: Array.from({ length: TRAIL }, () => new THREE.Vector4(0, 0, 0, 1)) },
      uTrailStep: { value: TRAIL_STEP },
      uTrailPhase: { value: 0 },
      uWind: { value: 0 },
      uColor: { value: new THREE.Color() },
      uWarm: { value: new THREE.Color() },
    }),
    [],
  );

  const geometry = useDispose(
    useMemo(() => {
      const g = new THREE.BufferGeometry();
      const pos = new Float32Array(n * 3);
      const seeds = new Float32Array(n);
      const rand = seeded(n * 7919 + seed);
      for (let i = 0; i < n; i++) {
        pos[i * 3] = (rand() - 0.5) * 0.015;
        pos[i * 3 + 2] = (rand() - 0.5) * 0.015;
        seeds[i] = rand();
      }
      g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
      return g;
    }, [n, seed]),
  );

  const puffMaterial = useDispose(
    useMemo(
      () =>
        new THREE.ShaderMaterial({
          vertexShader: puffVertex,
          fragmentShader: puffFragment,
          uniforms: {
            uTime: shared.uTime,
            uTrail: shared.uTrail,
            uTrailStep: shared.uTrailStep,
            uTrailPhase: shared.uTrailPhase,
            uWind: shared.uWind,
            uColor: shared.uColor,
            uWarm: shared.uWarm,
            uHeight: { value: height },
            uSpread: { value: spread },
            uSize: { value: size },
            uPixelRatio: { value: 1 },
            uOpacity: { value: opacity },
          },
          transparent: true,
          depthWrite: false,
        }),
      [shared, height, spread, size, opacity],
    ),
  );

  const ribbonGeometry = useDispose(
    useMemo(() => {
      const g = new THREE.PlaneGeometry(1, 1, 1, mode.low ? 64 : 120);
      g.translate(0, 0.5, 0);
      return g;
    }, [mode.low]),
  );

  const ribbonMaterial = useDispose(
    useMemo(
      () =>
        new THREE.ShaderMaterial({
          vertexShader: ribbonVertex,
          fragmentShader: ribbonFragment,
          uniforms: {
            uTime: shared.uTime,
            uTrail: shared.uTrail,
            uTrailStep: shared.uTrailStep,
            uTrailPhase: shared.uTrailPhase,
            uWind: shared.uWind,
            uColor: shared.uColor,
            uWarm: shared.uWarm,
            uHeight: { value: height * 0.62 },
            uWidth: { value: ribbonWidth },
            uRise: { value: 0.42 },
            uSeed: { value: seed * 1.7 },
            uOpacity: { value: ribbonOpacity },
          },
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      [shared, height, ribbonWidth, ribbonOpacity, seed],
    ),
  );

  useFrame((state, delta) => {
    const material = puffs.current?.material as THREE.ShaderMaterial | undefined;
    if (!material) return;
    // Time, colour, wind and trail uniforms are shared with the ribbon material.
    const u = material.uniforms;
    u.uTime.value = sceneTime(state.clock, mode, 9);
    // On the ivoire background pale smoke disappears: use a darker warm grey and more density.
    u.uColor.value.set(mode.light ? "#5f5044" : color);
    u.uWarm.value.set(mode.light ? "#6e5640" : warm);
    u.uWind.value = wind;
    u.uPixelRatio.value = state.gl.getPixelRatio();
    u.uOpacity.value = mode.light ? Math.min(0.6, opacity * 2.1) : opacity;
    const ru = uniformsOf(ribbonMesh.current);
    if (ru) ru.uOpacity.value = mode.light ? Math.min(0.9, ribbonOpacity * 1.5) : ribbonOpacity;

    const t = u.uTrail.value as THREE.Vector4[];
    const src = follow?.current;
    // Prime the whole history for the first couple of frames (a followed source may only be placed on frame 1).
    if (phase.current.frames < 2 || mode.still) {
      const w = strength?.current ?? 1;
      for (const p of t) {
        if (src) p.set(src.x, src.y, src.z, w);
        else p.set(0, 0, 0, w);
      }
      phase.current.frames++;
    }
    if (!src && !strength) return;
    // Newest sample always tracks the source; older samples shift down the history every step.
    const ph = phase.current;
    ph.acc += Math.min(delta, 1);
    while (ph.acc >= TRAIL_STEP) {
      ph.acc -= TRAIL_STEP;
      for (let i = TRAIL - 1; i > 1; i--) t[i].copy(t[i - 1]);
      t[1].copy(t[0]);
    }
    if (src) t[0].set(src.x, src.y, src.z, strength?.current ?? 1);
    else t[0].w = strength?.current ?? 1;
    u.uTrailPhase.value = ph.acc / TRAIL_STEP;
  });

  return (
    <group position={position}>
      {ribbon && (
        <mesh
          ref={ribbonMesh}
          geometry={ribbonGeometry}
          material={ribbonMaterial}
          frustumCulled={false}
          renderOrder={3}
        />
      )}
      <points
        ref={puffs}
        geometry={geometry}
        material={puffMaterial}
        frustumCulled={false}
        renderOrder={4}
      />
    </group>
  );
}
