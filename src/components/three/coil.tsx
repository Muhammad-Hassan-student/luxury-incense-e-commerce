"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { seeded } from "@/lib/use-client";
import { Smoke } from "./smoke";
import {
  Glow,
  Sparks,
  glslNoise,
  uniformsOf,
  lathe,
  sceneTime,
  useDispose,
  useGrain,
  useSceneMode,
} from "./shared";

/*
 * Mosquito coil: two interleaved Archimedean spirals swept with a flattened, rounded-rectangle profile,
 * slotted onto a little metal stand over a glazed dish. One spiral burns from its outer end inward:
 * a pulsing ember travels along it, leaving crumbly pale ash behind, while a thin ribbon of smoke rises
 * from wherever the ember currently is. At the end of the cycle the ash is quietly renewed and it relights.
 */

const R0 = 0.095; // inner radius where the spirals meet the centre tab
const PITCH = 0.122; // radial distance between turns of the same spiral (two spirals interleave)
const TURNS = 4.15;
const HALF_W = 0.021; // radial half-width of the strip
const HALF_H = 0.015; // vertical half-height (slightly flattened)
const RINGS = 900; // samples along each spiral
const PROFILE = 14;
const LIFT = 0.13; // coil height above the dish floor
const FLOOR = 0.026; // dish floor height
const COIL_Y = FLOOR + LIFT - 0.01;
const CYCLE = 150; // seconds for one full burn + renewal (slow: smoke stays upright)
const BURN_START = 0.015;
const BURN_END = 0.955;

type CoilData = { geometry: THREE.BufferGeometry; centre: Float32Array; length: number };

function spiralPoint(theta: number, phase: number, out: THREE.Vector3) {
  const r = R0 + (PITCH * theta) / (Math.PI * 2);
  return out.set(Math.cos(theta + phase) * r, 0, Math.sin(theta + phase) * r);
}

/** Builds both spirals in one geometry, with per-vertex arc position (aS), spiral id (aSp) and profile offset (aOff). */
function buildCoil(): CoilData {
  const thetaMax = TURNS * Math.PI * 2;
  // Dense θ samples → cumulative arc length, so rings are spaced evenly along the strip.
  const dense = 6000;
  const lens = new Float32Array(dense + 1);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  spiralPoint(0, 0, a);
  for (let i = 1; i <= dense; i++) {
    spiralPoint((i / dense) * thetaMax, 0, b);
    lens[i] = lens[i - 1] + a.distanceTo(b);
    a.copy(b);
  }
  const total = lens[dense];
  const thetaAt = (len: number) => {
    let lo = 0;
    let hi = dense;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lens[mid] < len) lo = mid;
      else hi = mid;
    }
    const f = (len - lens[lo]) / Math.max(1e-6, lens[hi] - lens[lo]);
    return ((lo + f) / dense) * thetaMax;
  };

  // Superellipse profile (flattened rounded rectangle) and its normals.
  const prof: { x: number; y: number; nx: number; ny: number }[] = [];
  const P = 0.55;
  for (let k = 0; k < PROFILE; k++) {
    const phi = (k / PROFILE) * Math.PI * 2;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const x = HALF_W * Math.sign(c) * Math.abs(c) ** P;
    const y = HALF_H * Math.sign(s) * Math.abs(s) ** P;
    const nx = (Math.sign(c) * Math.abs(c) ** (2 - P)) / HALF_W;
    const ny = (Math.sign(s) * Math.abs(s) ** (2 - P)) / HALF_H;
    const nl = Math.hypot(nx, ny) || 1;
    prof.push({ x, y, nx: nx / nl, ny: ny / nl });
  }

  const ringVerts = PROFILE + 1; // duplicate seam for UVs
  const perSpiral = RINGS * ringVerts + 2 * (PROFILE + 1); // + two end caps (ring copy + centre)
  const vCount = perSpiral * 2;
  const position = new Float32Array(vCount * 3);
  const normal = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const aS = new Float32Array(vCount);
  const aSp = new Float32Array(vCount);
  const aOff = new Float32Array(vCount * 3);
  const index: number[] = [];
  const centre = new Float32Array(RINGS * 3);

  const p = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let v = 0;

  const put = (
    px: number,
    py: number,
    pz: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    w: number,
    s: number,
    sp: number,
    ox: number,
    oy: number,
    oz: number,
  ) => {
    position.set([px, py, pz], v * 3);
    normal.set([nx, ny, nz], v * 3);
    uv.set([u, w], v * 2);
    aS[v] = s;
    aSp[v] = sp;
    aOff.set([ox, oy, oz], v * 3);
    return v++;
  };

  for (let sp = 0; sp < 2; sp++) {
    const phase = sp * Math.PI;
    const base = v;
    for (let i = 0; i < RINGS; i++) {
      // s = 0 at the outer end → 1 at the centre (the direction the ember travels).
      const s = i / (RINGS - 1);
      const len = (1 - s) * total;
      const th = thetaAt(len);
      spiralPoint(th, phase, p);
      // Analytic tangent of r(θ) = R0 + PITCH·θ/2π.
      const r = R0 + (PITCH * th) / (Math.PI * 2);
      const dr = PITCH / (Math.PI * 2);
      tangent
        .set(
          dr * Math.cos(th + phase) - r * Math.sin(th + phase),
          0,
          dr * Math.sin(th + phase) + r * Math.cos(th + phase),
        )
        .normalize();
      side.crossVectors(tangent, up).normalize();
      if (sp === 0) centre.set([p.x, p.y, p.z], i * 3);
      for (let k = 0; k <= PROFILE; k++) {
        const q = prof[k % PROFILE];
        const ox = side.x * q.x;
        const oz = side.z * q.x;
        const oy = q.y;
        put(
          p.x + ox,
          oy,
          p.z + oz,
          side.x * q.nx,
          q.ny,
          side.z * q.nx,
          len * 9,
          k / PROFILE,
          s,
          sp,
          ox,
          oy,
          oz,
        );
      }
    }
    for (let i = 0; i < RINGS - 1; i++) {
      for (let k = 0; k < PROFILE; k++) {
        const a0 = base + i * ringVerts + k;
        const a1 = a0 + 1;
        const b0 = a0 + ringVerts;
        const b1 = b0 + 1;
        index.push(a0, b0, a1, a1, b0, b1);
      }
    }
    // End caps (outer end and inner end).
    for (const [ring, dir] of [
      [0, 1],
      [RINGS - 1, -1],
    ] as const) {
      const s = ring / (RINGS - 1);
      const ringStart = base + ring * ringVerts;
      const cx = (position[ringStart * 3] + position[(ringStart + PROFILE / 2) * 3]) / 2;
      const cz = (position[ringStart * 3 + 2] + position[(ringStart + PROFILE / 2) * 3 + 2]) / 2;
      // Cap normal points along the strip (outwards at the end).
      const nx = position[(ringStart + ringVerts) * 3] - position[ringStart * 3];
      const nz = position[(ringStart + ringVerts) * 3 + 2] - position[ringStart * 3 + 2];
      const nl = Math.hypot(nx, nz) || 1;
      const cnx = (-dir * nx) / nl;
      const cnz = (-dir * nz) / nl;
      const capStart = v;
      for (let k = 0; k < PROFILE; k++) {
        const src = ringStart + k;
        put(
          position[src * 3],
          position[src * 3 + 1],
          position[src * 3 + 2],
          cnx,
          0,
          cnz,
          0,
          0,
          s,
          sp,
          aOff[src * 3],
          aOff[src * 3 + 1],
          aOff[src * 3 + 2],
        );
      }
      const c = put(cx, 0, cz, cnx, 0, cnz, 0, 0, s, sp, 0, 0, 0);
      for (let k = 0; k < PROFILE; k++) {
        const k1 = (k + 1) % PROFILE;
        if (dir === 1) index.push(c, capStart + k1, capStart + k);
        else index.push(c, capStart + k, capStart + k1);
      }
      v = capStart + PROFILE + 1;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(position.subarray(0, v * 3), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(normal.subarray(0, v * 3), 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv.subarray(0, v * 2), 2));
  g.setAttribute("aS", new THREE.BufferAttribute(aS.subarray(0, v), 1));
  g.setAttribute("aSp", new THREE.BufferAttribute(aSp.subarray(0, v), 1));
  g.setAttribute("aOff", new THREE.BufferAttribute(aOff.subarray(0, v * 3), 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  return { geometry: g, centre, length: total };
}

/** The centre tab where both spirals join, with the slot the stand's blade passes through. */
function buildTab() {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, R0 + HALF_W * 0.6, 0, Math.PI * 2, false);
  const slot = new THREE.Path();
  const sw = 0.007;
  const sh = 0.05;
  slot.moveTo(-sh, -sw);
  slot.lineTo(sh, -sw);
  slot.lineTo(sh, sw);
  slot.lineTo(-sh, sw);
  slot.closePath();
  shape.holes.push(slot);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: HALF_H * 2 - 0.006,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 2,
    curveSegments: 48,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -HALF_H + 0.003, 0);
  return g;
}

/* Burn shader injected into a standard material so it keeps full PBR lighting. */
function burnMaterial(color: string, bump: THREE.Texture) {
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.9,
    bumpMap: bump,
    bumpScale: 1.2,
  });
  const uniforms = {
    uBurn: { value: BURN_START },
    uLen: { value: 1 },
    uRegen: { value: 0 },
    uEmber: { value: 1 },
    uTime: { value: 0 },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float aS; attribute float aSp; attribute vec3 aOff;
        uniform float uBurn; uniform float uLen; uniform float uRegen;
        varying float vS; varying float vSp; varying vec3 vP;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vS = aS; vSp = aSp; vP = position;
        float dd = (aS - uBurn) * uLen;
        float renewed = step(aS, uRegen);
        float ashV = smoothstep(-0.03, -0.1, dd) * (1.0 - aSp) * (1.0 - renewed);
        // Ash shrinks a little and settles.
        transformed -= aOff * 0.13 * ashV;
        transformed.y -= 0.003 * ashV;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform float uBurn; uniform float uLen; uniform float uRegen; uniform float uEmber; uniform float uTime;
        varying float vS; varying float vSp; varying vec3 vP;
        ${glslNoise}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        float d = (vS - uBurn) * uLen;           // > 0 ahead of the ember, < 0 behind it
        float isA = 1.0 - vSp;
        float jitter = (mo_noise(vP * 60.0) - 0.5) * 0.03;
        float renewed = step(vS + jitter, uRegen);
        float k = isA * (1.0 - renewed);
        float charA = smoothstep(0.012, -0.008, d) * k;
        float ashA = smoothstep(-0.02, -0.1, d) * k;
        vec3 col = diffuseColor.rgb;
        col *= 1.0 - 0.4 * smoothstep(0.05, 0.0, d) * k;           // scorched just ahead of the ember
        col = mix(col, vec3(0.04, 0.034, 0.03), charA);
        float pores = mo_noise(vP * 110.0);
        vec3 ash = vec3(0.76, 0.74, 0.7) * (0.74 + 0.34 * pores);
        float along = vS * uLen;
        float crack = smoothstep(0.9, 0.97, fract(along * 17.0 + mo_noise(vP * 14.0) * 2.6));
        ash *= 1.0 - crack * 0.6;
        ash = mix(ash, vec3(0.32, 0.3, 0.28), smoothstep(-0.1, -0.03, d) * 0.6);  // grey-black where freshly burnt
        col = mix(col, ash, ashA);
        diffuseColor.rgb = col;`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 1.0, ashA);`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float pulse = 2.4 + 0.9 * sin(uTime * 2.9) + 0.45 * sin(uTime * 7.7 + 1.0);
        float core = exp(-pow((d + 0.006) / 0.011, 2.0)) * k;
        float specks = smoothstep(0.72, 0.95, mo_noise(vP * 75.0 + vec3(0.0, uTime * 0.7, 0.0))) * smoothstep(0.004, -0.01, d) * smoothstep(-0.08, -0.025, d) * k;
        totalEmissiveRadiance += vec3(1.0, 0.33, 0.07) * uEmber * (core * pulse + specks * 1.5);
        float front = exp(-pow((vS - uRegen) / 0.018, 2.0)) * step(0.0005, uRegen) * step(uRegen, 0.999) * isA;
        totalEmissiveRadiance += vec3(1.0, 0.8, 0.45) * front * 0.7;`,
      );
  };
  m.userData.u = uniforms;
  m.customProgramCacheKey = () => "mo-coil-burn";
  return { material: m, uniforms };
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function Coil({ color, accent, smoke }: { color: string; accent: string; smoke: boolean }) {
  const mode = useSceneMode();
  const data = useMemo(() => buildCoil(), []);
  useDispose(useMemo(() => data.geometry, [data]));
  const tab = useDispose(useMemo(() => buildTab(), []));
  const grain = useGrain(1, 6);
  const burn = useDispose(
    useMemo(() => {
      const b = burnMaterial(color, grain);
      b.uniforms.uLen.value = data.length;
      return Object.assign(b, { dispose: () => b.material.dispose() });
    }, [color, grain, data]),
  );

  const dish = useDispose(
    useMemo(
      () =>
        lathe(
          [
            [0, 0],
            [0.5, 0],
            [0.66, 0.012],
            [0.8, 0.05],
            [0.875, 0.1],
            [0.885, 0.112],
            [0.872, 0.116],
            [0.79, 0.068],
            [0.64, 0.034],
            [0.48, 0.026],
            [0, 0.026],
          ],
          128,
        ),
      [],
    ),
  );
  const steel = useDispose(
    useMemo(
      () => new THREE.MeshStandardMaterial({ color: "#8d877e", metalness: 1, roughness: 0.38 }),
      [],
    ),
  );
  const gold = useDispose(
    useMemo(
      () => new THREE.MeshStandardMaterial({ color: accent, metalness: 1, roughness: 0.3 }),
      [accent],
    ),
  );

  // Fallen ash flakes on the dish (static, seeded).
  const ashBits = useMemo(() => {
    const rand = seeded(4242);
    return Array.from({ length: 16 }, () => {
      const r = 0.22 + rand() * 0.42;
      const a = rand() * Math.PI * 2;
      return {
        p: [Math.cos(a) * r, 0.034, Math.sin(a) * r] as [number, number, number],
        s: 0.008 + rand() * 0.014,
        rot: [rand() * 3, rand() * 3, rand() * 3] as [number, number, number],
      };
    });
  }, []);

  const ember = useRef(new THREE.Vector3());
  const emberStrength = useRef(1);
  const glow = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const coil = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = sceneTime(state.clock, mode, CYCLE * 0.42);
    const p = (t % CYCLE) / CYCLE;
    const burnP = Math.min(1, p / 0.9);
    const s = BURN_START + (BURN_END - BURN_START) * burnP;
    // Ember fades in on relight and out at the centre; ash renews after it dies.
    const e = smooth(0, 0.025, p) * (1 - smooth(0.875, 0.9, p));
    const regen = p > 0.9 ? smooth(0.905, 0.99, p) : 0;
    const u = uniformsOf(coil.current);
    if (u) {
      u.uBurn.value = s;
      u.uEmber.value = e;
      u.uRegen.value = regen;
      u.uTime.value = t;
    }

    // Ember position along spiral A (lerp between the two nearest rings).
    const f = s * (RINGS - 1);
    const i = Math.min(RINGS - 2, Math.floor(f));
    const w = f - i;
    const c = data.centre;
    ember.current.set(
      c[i * 3] + (c[i * 3 + 3] - c[i * 3]) * w,
      COIL_Y + 0.004,
      c[i * 3 + 2] + (c[i * 3 + 5] - c[i * 3 + 2]) * w,
    );
    emberStrength.current = e;
    if (glow.current) {
      glow.current.position.copy(ember.current);
      glow.current.scale.setScalar(0.0001 + e * (0.92 + Math.sin(t * 2.9) * 0.08));
    }
    if (light.current) {
      light.current.position.set(ember.current.x, ember.current.y + 0.05, ember.current.z);
      light.current.intensity = e * (0.55 + Math.sin(t * 2.9) * 0.1);
    }
  });

  return (
    <group position={[0, -0.5, 0]}>
      {/* Glazed dish */}
      <mesh geometry={dish} receiveShadow castShadow>
        <meshPhysicalMaterial
          color="#2e2925"
          roughness={0.42}
          clearcoat={0.5}
          clearcoatRoughness={0.3}
          envMapIntensity={0.6}
        />
      </mesh>
      <mesh position={[0, FLOOR + 0.0007, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.43, 0.442, 128]} />
        <meshStandardMaterial color={accent} metalness={1} roughness={0.3} />
      </mesh>
      <InstancedAshBits bits={ashBits} />

      {/* Stand: a little foot, a blade through the slot, and split prongs above */}
      <group position={[0, FLOOR, 0]}>
        <mesh material={steel} position={[0, 0.004, 0]} castShadow>
          <cylinderGeometry args={[0.065, 0.075, 0.008, 40]} />
        </mesh>
        <mesh material={steel} position={[0, LIFT * 0.5, 0]} castShadow>
          <boxGeometry args={[0.088, LIFT - 0.012, 0.004]} />
        </mesh>
        {[-1, 1].map((sgn) => (
          <mesh
            key={sgn}
            material={steel}
            position={[sgn * 0.022, LIFT + 0.012, 0]}
            rotation={[0, 0, sgn * -0.12]}
            castShadow
          >
            <boxGeometry args={[0.02, 0.05, 0.004]} />
          </mesh>
        ))}
        <mesh material={gold} position={[0, 0.0095, 0]}>
          <torusGeometry args={[0.07, 0.0025, 8, 48]} />
        </mesh>
      </group>

      {/* The coil itself */}
      <group position={[0, COIL_Y, 0]}>
        <mesh
          ref={coil}
          geometry={data.geometry}
          material={burn.material}
          castShadow
          receiveShadow
        />
        <mesh geometry={tab} castShadow>
          <meshStandardMaterial color={color} roughness={0.9} bumpMap={grain} bumpScale={1.2} />
        </mesh>
      </group>

      <group>
        <Glow glowRef={glow} size={0.12} color="#ff6a1f" intensity={1.4} />
        <pointLight ref={light} color="#ff7a2a" intensity={0.5} distance={1.4} decay={2} />
        <Sparks origin={ember} count={10} rate={0.16} />
        {smoke && (
          <Smoke
            follow={ember}
            strength={emberStrength}
            height={2.1}
            spread={0.36}
            count={300}
            size={170}
            opacity={0.11}
            ribbonWidth={0.03}
            ribbonOpacity={0.45}
            seed={3}
          />
        )}
      </group>
    </group>
  );
}

/** Fallen ash flakes, one instanced draw call. */
function InstancedAshBits({
  bits,
}: {
  bits: { p: [number, number, number]; s: number; rot: [number, number, number] }[];
}) {
  const geometry = useDispose(useMemo(() => new THREE.DodecahedronGeometry(1, 0), []));
  const matrices = useMemo(() => {
    const o = new THREE.Object3D();
    return bits.map((b) => {
      o.position.set(...b.p);
      o.rotation.set(...b.rot);
      o.scale.set(b.s * 1.4, b.s * 0.5, b.s);
      o.updateMatrix();
      return o.matrix.clone();
    });
  }, [bits]);
  return (
    <instancedMesh
      ref={(m) => {
        if (!m) return;
        matrices.forEach((mat, i) => m.setMatrixAt(i, mat));
        m.instanceMatrix.needsUpdate = true;
      }}
      args={[geometry, undefined, bits.length]}
      receiveShadow
    >
      <meshStandardMaterial color="#b9b4ab" roughness={1} />
    </instancedMesh>
  );
}
