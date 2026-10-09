"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { seeded } from "@/lib/use-client";
import {
  clearGlass,
  glslNoise,
  sceneTime,
  useBudget,
  useDispose,
  useGold,
  useSceneMode,
  uniformsOf,
} from "./shared";

/*
 * Couture flacon: thick, chamfer-cut glass (transmission + a touch of dispersion) holding a coloured juice
 * that sways gently, a polished gold collar, and a vintage bulb atomiser in silk netting with a braided
 * tassel. Every few seconds the bulb is squeezed and a fine, glittering mist drifts from the nozzle,
 * followed by a few slow golden "notes".
 */

const PERIOD = 5.5; // seconds between sprays
const GEM_R = 0.42; // faceted gem flacon radius
const GEM_Y = 0.36; // its centre height
const GEM_DEPTH = 0.64; // squashed front-to-back
const TOP = GEM_Y + 0.36; // flat top facet where the collar sits
const NOZZLE: [number, number, number] = [0.135, TOP + 0.17, 0];

/** Press curve: quick squeeze, slower release (0 → 1 → 0 over ~0.6 s). */
function press(t: number) {
  const tau = ((t % PERIOD) + PERIOD) % PERIOD;
  if (tau < 0.16) return Math.sin((tau / 0.16) * Math.PI * 0.5);
  if (tau < 0.62) return 0.5 + 0.5 * Math.cos(((tau - 0.16) / 0.46) * Math.PI);
  return 0;
}

const mistVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPeriod;
  uniform float uPixelRatio;
  uniform vec3 uNozzle;
  attribute vec4 aRand;   // x: seed, y/z: cone, w: kind (0 droplet, 1 haze)
  varying float vA;
  varying float vTw;
  varying float vKind;
  ${glslNoise}
  void main() {
    float seed = aRand.x;
    float kind = aRand.w;
    float tau = mod(uTime - 0.1 - seed * 0.32, uPeriod);
    float life = mix(2.0 + fract(seed * 7.3) * 1.6, 3.4 + fract(seed * 3.1) * 1.4, kind);
    float alive = step(tau, life);
    float k = 3.8;
    float v0 = mix(1.1 + fract(seed * 13.7) * 1.0, 0.8 + fract(seed * 5.9) * 0.5, kind);
    vec3 dir = normalize(vec3(1.0, 0.12 + aRand.y * 0.34, aRand.z * 0.34));
    float dist = v0 * (1.0 - exp(-k * tau)) / k;
    vec3 p = uNozzle + dir * dist;
    // Drifting, diffusing, lifting slightly; heavier droplets settle.
    vec3 q = vec3(p.x * 2.0, seed * 17.0, uTime * 0.25);
    p += (vec3(mo_noise(q), mo_noise(q + 3.1), mo_noise(q + 7.7)) - 0.5) * tau * (0.18 + kind * 0.2);
    p.y += tau * 0.03 - tau * tau * 0.012 * (1.0 - kind);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float grow = 1.0 + tau * mix(0.5, 1.2, kind);
    float sz = mix(2.6 + fract(seed * 31.0) * 3.6, 40.0 + fract(seed * 11.0) * 30.0, kind);
    gl_PointSize = min(sz * grow * (3.6 / -mv.z), 160.0) * uPixelRatio * alive;
    float fade = smoothstep(0.0, 0.05, tau) * (1.0 - smoothstep(life * 0.45, life, tau));
    vA = fade * alive * mix(0.9, 0.03, kind);
    // Glitter: brief bright glints as droplets catch the light.
    vTw = pow(max(0.0, sin(uTime * (6.0 + seed * 10.0) + seed * 40.0)), 14.0) * (1.0 - kind);
    vKind = kind;
  }
`;

const mistFragment = /* glsl */ `
  uniform vec3 uTint;
  uniform float uLight;
  varying float vA;
  varying float vTw;
  varying float vKind;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float a = mix(smoothstep(0.5, 0.1, d), exp(-d * d * 12.0), vKind) * vA;
    vec3 col = mix(vec3(0.96, 0.95, 0.92), uTint, 0.25 + vKind * 0.3);
    col += vec3(1.0, 0.86, 0.55) * vTw * 3.0;
    // Light page: additive white vanishes, so draw warm, slightly darker droplets instead.
    col = mix(col, vec3(0.52, 0.42, 0.3) + vec3(0.5, 0.4, 0.2) * vTw, uLight);
    gl_FragColor = vec4(col * (1.0 + vTw * 2.0 * (1.0 - uLight)), min(1.0, a * (1.0 + vTw) * (1.0 + uLight * 0.6)));
  }
`;

const noteVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPeriod;
  uniform float uPixelRatio;
  uniform vec3 uNozzle;
  attribute vec4 aRand;
  varying float vA;
  varying float vRot;
  void main() {
    float seed = aRand.x;
    float tau = mod(uTime - 0.35 - seed * 0.8, uPeriod);
    float life = 3.6 + aRand.w * 1.4;
    float alive = step(tau, life);
    vec3 p = uNozzle + vec3(0.25 + aRand.y * 0.35 + tau * 0.06, 0.02 + tau * (0.07 + aRand.w * 0.05), aRand.z * 0.25);
    p.x += sin(tau * 1.3 + seed * 20.0) * 0.03;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float tw = 0.55 + 0.45 * sin(uTime * (2.5 + aRand.w * 2.0) + seed * 30.0);
    gl_PointSize = (14.0 + aRand.w * 10.0) * tw * uPixelRatio * alive * (2.6 / -mv.z);
    vA = alive * smoothstep(0.0, 0.5, tau) * (1.0 - smoothstep(life * 0.5, life, tau)) * tw;
    vRot = seed * 6.283 + uTime * 0.4;
  }
`;

const noteFragment = /* glsl */ `
  varying float vA;
  varying float vRot;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    uv = mat2(cos(vRot), -sin(vRot), sin(vRot), cos(vRot)) * uv;
    float d = length(uv);
    // Four-point star with a soft core.
    float rays = max(exp(-abs(uv.x) * 60.0) * exp(-abs(uv.y) * 5.0), exp(-abs(uv.y) * 60.0) * exp(-abs(uv.x) * 5.0));
    float core = exp(-d * d * 120.0);
    float a = (rays * 0.8 + core) * smoothstep(0.5, 0.3, d) * vA;
    gl_FragColor = vec4(vec3(1.0, 0.8, 0.45) * 3.0 * a, a);
  }
`;

function Mist({ tint }: { tint: string }) {
  const mode = useSceneMode();
  const n = useBudget(900);
  const notes = useBudget(16);
  const build = (count: number, seed: number, hazeShare: number) => {
    const g = new THREE.BufferGeometry();
    const rand = seeded(seed);
    const r = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      // Gaussian-ish cone: denser in the middle.
      const a = rand() * Math.PI * 2;
      const rad = Math.sqrt(-2 * Math.log(Math.max(1e-4, rand()))) * 0.45;
      r.set(
        [rand(), Math.cos(a) * rad, Math.sin(a) * rad, i < count * hazeShare ? 1 : rand()],
        i * 4,
      );
    }
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute("aRand", new THREE.BufferAttribute(r, 4));
    return g;
  };
  const mistGeo = useDispose(
    useMemo(() => {
      const g = build(n, 77, 0.05);
      // Only the first 5% are haze; the rest are droplets.
      const r = g.getAttribute("aRand") as THREE.BufferAttribute;
      for (let i = Math.floor(n * 0.05); i < n; i++) r.setW(i, 0);
      return g;
    }, [n]),
  );
  const noteGeo = useDispose(useMemo(() => build(notes, 91, 0), [notes]));
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPeriod: { value: PERIOD },
      uPixelRatio: { value: 1 },
      uNozzle: { value: new THREE.Vector3(...NOZZLE) },
      uTint: { value: new THREE.Color(tint) },
      uLight: { value: 0 },
    }),
    [tint],
  );
  const mistMat = useDispose(
    useMemo(
      () =>
        new THREE.ShaderMaterial({
          vertexShader: mistVertex,
          fragmentShader: mistFragment,
          uniforms,
          transparent: true,
          depthWrite: false,
          blending: mode.light ? THREE.NormalBlending : THREE.AdditiveBlending,
          toneMapped: false,
        }),
      [uniforms, mode.light],
    ),
  );
  const noteMat = useDispose(
    useMemo(
      () =>
        new THREE.ShaderMaterial({
          vertexShader: noteVertex,
          fragmentShader: noteFragment,
          uniforms,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      [uniforms],
    ),
  );
  const mist = useRef<THREE.Points>(null);
  useFrame((state) => {
    // Mist and notes share one uniforms object.
    const u = uniformsOf(mist.current);
    if (!u) return;
    u.uTime.value = sceneTime(state.clock, mode, PERIOD * 2 + 0.95);
    u.uPixelRatio.value = state.gl.getPixelRatio();
  });
  return (
    <>
      <points
        ref={mist}
        geometry={mistGeo}
        material={mistMat}
        frustumCulled={false}
        renderOrder={7}
      />
      <points geometry={noteGeo} material={noteMat} frustumCulled={false} renderOrder={8} />
    </>
  );
}

/** Silk-netted bulb: silk base with a diamond net of gold thread, all in one material. */
function useNetMaterial(silk: string, gold: string) {
  return useDispose(
    useMemo(() => {
      const m = new THREE.MeshPhysicalMaterial({
        color: silk,
        roughness: 0.55,
        sheen: 1,
        sheenColor: new THREE.Color(silk).lerp(new THREE.Color("#ffffff"), 0.35),
        sheenRoughness: 0.4,
      });
      const goldColor = new THREE.Color(gold);
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uGold = { value: goldColor };
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            `#include <common>
          uniform vec3 uGold;
          float moNet(vec2 uv) {
            vec2 g = vec2(uv.x * 28.0 + uv.y * 14.0, uv.x * 28.0 - uv.y * 14.0);
            vec2 f = abs(fract(g) - 0.5);
            return smoothstep(0.38, 0.47, max(f.x, f.y));
          }`,
          )
          .replace(
            "#include <color_fragment>",
            `#include <color_fragment>
          float net = moNet(vNetUv);
          diffuseColor.rgb = mix(diffuseColor.rgb, uGold, net);`,
          )
          .replace(
            "#include <metalnessmap_fragment>",
            `#include <metalnessmap_fragment>
          metalnessFactor = mix(metalnessFactor, 1.0, net);`,
          )
          .replace(
            "#include <roughnessmap_fragment>",
            `#include <roughnessmap_fragment>
          roughnessFactor = mix(roughnessFactor, 0.28, net);`,
          )
          .replace("void main() {", "varying vec2 vNetUv;\nvoid main() {");
        shader.vertexShader = shader.vertexShader.replace(
          "void main() {",
          "varying vec2 vNetUv;\nvoid main() {\n  vNetUv = uv;",
        );
      };
      m.customProgramCacheKey = () => "mo-net";
      return m;
    }, [silk, gold]),
  );
}

/** Juice: a soft inner volume whose top is clipped to a gently rocking level (normals point up there). */
function useJuiceMaterial(color: THREE.Color, fill: number, floor: number) {
  return useDispose(
    useMemo(() => {
      const m = new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.06,
        clearcoat: 1,
        clearcoatRoughness: 0.04,
        emissive: color,
        emissiveIntensity: 0.45,
        sheen: 0.5,
        sheenColor: color.clone().lerp(new THREE.Color("#ffffff"), 0.4),
      });
      const uniforms = {
        uTilt: { value: new THREE.Vector2() },
        uFill: { value: fill },
        uFloor: { value: floor },
      };
      m.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace(
            "#include <common>",
            "#include <common>\nuniform vec2 uTilt; uniform float uFill; uniform float uFloor;",
          )
          .replace(
            "#include <beginnormal_vertex>",
            `#include <beginnormal_vertex>
          float lvl = uFill + uTilt.x * position.x + uTilt.y * position.z;
          if (position.y > lvl) objectNormal = normalize(vec3(-uTilt.x, 1.0, -uTilt.y));
          if (position.y < uFloor) objectNormal = vec3(0.0, -1.0, 0.0);`,
          )
          .replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
          transformed.y = clamp(transformed.y, uFloor, lvl);`,
          );
      };
      m.customProgramCacheKey = () => "mo-juice";
      m.userData.u = uniforms;
      return m;
    }, [color, fill, floor]),
  );
}

export function Perfume({ juice, accent }: { juice: string; accent: string }) {
  const mode = useSceneMode();
  const gold = useGold(accent, 0.18);
  const juiceColor = useMemo(
    () => new THREE.Color(juice).lerp(new THREE.Color(accent), 0.45),
    [juice, accent],
  );
  const glassGeo = useDispose(
    useMemo(() => {
      // Icosahedral gem: crisp facets, flat base and a flat top facet for the collar.
      const g = new THREE.IcosahedronGeometry(GEM_R, 1);
      const p = g.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) p.setY(i, THREE.MathUtils.clamp(p.getY(i), -0.34, 0.36));
      g.scale(1, 1, GEM_DEPTH);
      g.computeVertexNormals();
      return g;
    }, []),
  );
  const juiceGeo = useDispose(
    useMemo(() => new THREE.SphereGeometry(GEM_R * 0.8, 48, 32).scale(1, 1, GEM_DEPTH * 0.92), []),
  );
  const glass = useDispose(
    useMemo(
      () =>
        clearGlass(
          new THREE.MeshPhysicalMaterial({
            color: "#ffffff",
            transmission: 1,
            thickness: 0.45,
            roughness: 0.01,
            ior: 1.55,
            dispersion: mode.low ? 0 : 0.6,
            attenuationColor: new THREE.Color(juice).lerp(new THREE.Color("#ffffff"), 0.8),
            attenuationDistance: 2,
            clearcoat: 1,
            clearcoatRoughness: 0.02,
            specularIntensity: 1,
            envMapIntensity: 2.4,
            flatShading: true,
          }),
          0.14,
        ),
      [juice, mode.low],
    ),
  );
  const juiceMat = useJuiceMaterial(juiceColor, 0.17, -0.25);
  const net = useNetMaterial(
    new THREE.Color(juice).lerp(new THREE.Color("#5a1020"), 0.45).getStyle(),
    accent,
  );

  // Atomiser hose: from the head, out to the left and down to the bulb.
  const hose = useDispose(
    useMemo(() => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-0.05, TOP + 0.15, 0),
        new THREE.Vector3(-0.2, TOP + 0.17, 0),
        new THREE.Vector3(-0.34, TOP + 0.08, 0.02),
        new THREE.Vector3(-0.42, TOP - 0.06, 0.04),
      ]);
      return new THREE.TubeGeometry(curve, 48, 0.011, 12, false);
    }, []),
  );
  // Braided cord: three intertwined helices.
  const cord = useDispose(
    useMemo(() => {
      const parts = [0, 1, 2].map((k) => {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 24; i++) {
          const t = i / 24;
          const a = t * Math.PI * 6 + (k * Math.PI * 2) / 3;
          pts.push(new THREE.Vector3(Math.cos(a) * 0.0045, -t * 0.07, Math.sin(a) * 0.0045));
        }
        return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.0032, 6, false);
      });
      const merged = mergeGeometries(parts);
      parts.forEach((g) => g.dispose());
      return merged;
    }, []),
  );
  const strands = useMemo(() => {
    const rand = seeded(55);
    return Array.from({ length: 22 }, (_, i) => {
      const a = (i / 22) * Math.PI * 2 + rand() * 0.2;
      return { a, tilt: 0.06 + rand() * 0.1, len: 0.13 + rand() * 0.03 };
    });
  }, []);
  const strandGeo = useDispose(
    useMemo(() => new THREE.CylinderGeometry(0.0022, 0.0018, 1, 5).translate(0, -0.5, 0), []),
  );
  const silkStrand = useDispose(
    useMemo(
      () =>
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(accent).lerp(new THREE.Color("#ffffff"), 0.1),
          metalness: 0.6,
          roughness: 0.38,
        }),
      [accent],
    ),
  );

  const juiceMesh = useRef<THREE.Mesh>(null);
  const bulb = useRef<THREE.Group>(null);
  const tassel = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);

  useFrame((state) => {
    const t = sceneTime(state.clock, mode, PERIOD * 2 + 0.95);
    const pr = press(t);
    if (bulb.current) bulb.current.scale.set(1 + pr * 0.08, 1 - pr * 0.16, 1 + pr * 0.08);
    if (head.current) head.current.position.y = -pr * 0.006;
    // Juice rocks gently, with a small slosh after each squeeze.
    const since = ((t % PERIOD) + PERIOD) % PERIOD;
    const slosh = Math.exp(-since * 1.4) * Math.sin(since * 7) * 0.05;
    (uniformsOf(juiceMesh.current)?.uTilt.value as THREE.Vector2 | undefined)?.set(
      Math.sin(t * 0.8) * 0.035 + slosh,
      Math.sin(t * 0.6 + 1) * 0.025,
    );
    if (tassel.current) {
      tassel.current.rotation.z =
        Math.sin(t * 1.1) * 0.05 + Math.exp(-since * 1.2) * Math.sin(since * 4.2) * 0.12;
      tassel.current.rotation.x = Math.sin(t * 0.8 + 2) * 0.04;
    }
  });

  return (
    <group position={[-0.08, -0.55, 0]}>
      {/* Glass and juice */}
      <group position={[0, GEM_Y, 0]}>
        <mesh ref={juiceMesh} geometry={juiceGeo} material={juiceMat} />
        <mesh geometry={glassGeo} material={glass} castShadow />
      </group>
      {/* Gold neck ring */}
      <mesh material={gold} position={[0, TOP - 0.004, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.105, 0.007, 10, 56]} />
      </mesh>
      {/* Collar, head and nozzle */}
      <mesh material={gold} position={[0, TOP + 0.025, 0]} castShadow>
        <cylinderGeometry args={[0.085, 0.1, 0.05, 48]} />
      </mesh>
      {[0.012, 0.04].map((y) => (
        <mesh key={y} material={gold} position={[0, TOP + y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.094 - y * 0.25, 0.006, 10, 48]} />
        </mesh>
      ))}
      <group ref={head}>
        <mesh material={gold} position={[0, TOP + 0.1, 0]} castShadow>
          <cylinderGeometry args={[0.055, 0.07, 0.1, 40]} />
        </mesh>
        <mesh material={gold} position={[0, TOP + 0.165, 0]}>
          <sphereGeometry args={[0.055, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
        <mesh material={gold} position={[0.075, TOP + 0.17, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.012, 0.016, 0.12, 16]} />
        </mesh>
        <mesh material={gold} position={[0, TOP + 0.235, 0]}>
          <sphereGeometry args={[0.022, 24, 16]} />
        </mesh>
      </group>

      {/* Hose, bulb and tassel */}
      <mesh geometry={hose} material={gold} castShadow />
      <group position={[-0.42, TOP - 0.06, 0.04]}>
        <mesh material={gold} position={[0, -0.01, 0]}>
          <cylinderGeometry args={[0.016, 0.026, 0.035, 24]} />
        </mesh>
        <group ref={bulb} position={[0, -0.12, 0]}>
          <mesh material={net} scale={[1, 1.22, 1]} castShadow>
            <sphereGeometry args={[0.085, 48, 32]} />
          </mesh>
          <mesh material={gold} position={[0, -0.105, 0]}>
            <sphereGeometry args={[0.016, 20, 12]} />
          </mesh>
        </group>
        <group ref={tassel} position={[0, -0.24, 0]}>
          <mesh geometry={cord} material={silkStrand} />
          <mesh material={gold} position={[0, -0.075, 0]}>
            <sphereGeometry args={[0.018, 24, 16]} />
          </mesh>
          <mesh material={gold} position={[0, -0.095, 0]}>
            <cylinderGeometry args={[0.02, 0.014, 0.03, 24]} />
          </mesh>
          {strands.map((s, i) => (
            <mesh
              key={i}
              geometry={strandGeo}
              material={silkStrand}
              position={[Math.cos(s.a) * 0.012, -0.105, Math.sin(s.a) * 0.012]}
              rotation={[Math.sin(s.a) * s.tilt, 0, -Math.cos(s.a) * s.tilt]}
              scale={[1, s.len, 1]}
            />
          ))}
        </group>
      </group>

      <Mist tint={accent} />
    </group>
  );
}
