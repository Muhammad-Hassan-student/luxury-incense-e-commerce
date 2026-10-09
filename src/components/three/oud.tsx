"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Smoke } from "./smoke";
import {
  Glow,
  clearGlass,
  glslNoise,
  lathe,
  sceneTime,
  useDispose,
  useEngravedBrass,
  useGold,
  useSceneMode,
  uniformsOf,
} from "./shared";

/*
 * Oud: a gnarled piece of resinous agarwood (noise-displaced, with glossy amber resin veins that breathe)
 * resting on an engraved brass tray, smouldering softly at one end. Beside it a glass pipette of oud oil
 * slowly gathers one heavy golden drop, lets it fall into a tiny dish, and the oil ripples.
 */

const DROP_PERIOD = 6.5;
const FORM_END = 4.6; // drop grows until here
const NECK_END = 5.05; // pendant stretch
const TIP_Y = 0.27; // pipette tip height above the dish
const POOL_Y = 0.056; // oil surface inside the dish
const FALL = Math.sqrt((2 * (TIP_Y - 0.038 - POOL_Y)) / 4.2); // seconds to fall at g = 4.2
const DISH: [number, number, number] = [0.4, 0.022, 0.3];

/* Small deterministic value noise for building geometry on the CPU. */
function hash3(x: number, y: number, z: number) {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise3(x: number, y: number, z: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(
      l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u),
      l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u),
      v,
    ),
    l(
      l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u),
      l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u),
      v,
    ),
    w,
  );
}
const fbm = (x: number, y: number, z: number) =>
  noise3(x, y, z) * 0.55 +
  noise3(x * 2.1 + 5, y * 2.1, z * 2.1) * 0.3 +
  noise3(x * 4.3, y * 4.3 + 9, z * 4.3) * 0.15;

/** Agarwood chunk: elongated, twisted, lumpy, splintered at one end, flat-ish underneath; aVein marks resin. */
function buildWood(low: boolean) {
  const g = new THREE.SphereGeometry(1, low ? 96 : 160, low ? 48 : 80);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const vein = new Float32Array(pos.count);
  const p = new THREE.Vector3();
  const cuts = Array.from({ length: 9 }, (_, k) => {
    const a = hash3(k, 3, 7) * Math.PI * 2;
    const e = (hash3(k, 5, 1) - 0.35) * 1.4;
    const n = new THREE.Vector3(
      Math.cos(a) * Math.cos(e) * 0.35,
      Math.sin(e),
      Math.sin(a) * Math.cos(e),
    ).normalize();
    // Offset relative to the shape's extent along that direction.
    const extent = Math.abs(n.x) * 0.6 + Math.abs(n.y) * 0.19 + Math.abs(n.z) * 0.23;
    return [n.x, n.y, n.z, extent * (0.55 + hash3(k, 9, 2) * 0.2)] as const;
  });
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const n = p.clone();
    // Base proportions: a long, slightly bent branch section.
    let x = p.x * 0.6;
    let y = p.y * 0.17;
    let z = p.z * 0.21;
    // Lumps and knots.
    const lump = fbm(p.x * 1.8 + 3, p.y * 1.8, p.z * 1.8) - 0.5;
    const knot = Math.max(0, noise3(p.x * 3 + 11, p.y * 3, p.z * 3) - 0.62) * 0.5;
    const r = 1 + lump * 0.8 + knot;
    y *= r;
    z *= r;
    // Fibrous ridges running along the grain (x).
    const ridge = 1 - Math.abs(noise3(p.x * 1.2, p.y * 9, p.z * 9) * 2 - 1);
    y += n.y * ridge * 0.02;
    z += n.z * ridge * 0.02;
    // Splintered, tapering right end.
    const end = Math.max(0, p.x - 0.55) / 0.45;
    const splinter = (noise3(p.x * 2, p.y * 14 + 3, p.z * 14) - 0.5) * 0.25 * end;
    x += splinter * 0.4 + end * end * 0.04;
    y *= 1 - end * 0.45;
    z *= 1 - end * 0.35;
    // Bend and twist.
    y += Math.cos(x * 2.6) * 0.05 - 0.02;
    const tw = x * 0.9;
    const cy = y * Math.cos(tw) - z * Math.sin(tw) * 0.3;
    const cz = z * Math.cos(tw) + y * Math.sin(tw) * 0.3;
    y = cy;
    z = cz;
    // Knife-scraped facets: a few planes shave the lumps flat, as on hand-cleaned agarwood.
    for (const c of cuts) {
      const d = x * c[0] + y * c[1] + z * c[2] - c[3];
      if (d > 0) {
        x -= c[0] * d * 0.9;
        y -= c[1] * d * 0.9;
        z -= c[2] * d * 0.9;
      }
    }
    // Rest on the tray: soften and flatten the underside.
    if (y < -0.11) y = -0.11 + (y + 0.11) * 0.18;
    pos.setXYZ(i, x, y, z);

    // Resin: thin veins along the fibres + a few broader patches.
    const v = 1 - Math.abs(noise3(p.x * 2.4 + 1, p.y * 7, p.z * 7) * 2 - 1);
    const patch = fbm(p.x * 1.4 + 20, p.y * 1.4, p.z * 1.4);
    vein[i] = Math.min(1, Math.pow(v, 16) * 1.3 * (0.3 + patch) + Math.max(0, patch - 0.64) * 3.5);
  }
  g.setAttribute("aVein", new THREE.BufferAttribute(vein, 1));
  g.computeVertexNormals();
  return g;
}

function useWoodMaterial() {
  return useDispose(
    useMemo(() => {
      const m = new THREE.MeshPhysicalMaterial({
        color: "#3b2516",
        roughness: 0.78,
        clearcoat: 0.12,
        clearcoatRoughness: 0.3,
        envMapIntensity: 0.55,
      });
      const uniforms = { uTime: { value: 0 } };
      m.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace(
            "#include <common>",
            "#include <common>\nattribute float aVein;\nvarying float vVein;\nvarying vec3 vP;",
          )
          .replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\nvVein = aVein;\nvP = position;",
          );
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            `#include <common>\nuniform float uTime;\nvarying float vVein;\nvarying vec3 vP;\n${glslNoise}`,
          )
          .replace(
            "#include <color_fragment>",
            `#include <color_fragment>
          // Fibrous grain along the length, warped by noise.
          float warp = mo_noise(vP * vec3(2.0, 8.0, 8.0)) * 1.4;
          float grain = 0.5 + 0.5 * sin((vP.y * 60.0 + vP.z * 45.0) + warp * 6.0);
          float fib = mo_noise(vP * vec3(4.0, 70.0, 70.0));
          vec3 wood = mix(vec3(0.075, 0.045, 0.028), vec3(0.24, 0.15, 0.085), grain * 0.5 + fib * 0.5);
          float resin = smoothstep(0.2, 0.75, vVein);
          vec3 resinCol = mix(vec3(0.07, 0.03, 0.012), vec3(0.42, 0.19, 0.05), mo_noise(vP * 30.0));
          diffuseColor.rgb = mix(wood, resinCol, resin);`,
          )
          .replace(
            "#include <roughnessmap_fragment>",
            `#include <roughnessmap_fragment>
          roughnessFactor = mix(0.86, 0.26, resin);`,
          )
          .replace(
            "#include <emissivemap_fragment>",
            `#include <emissivemap_fragment>
          // Resin breathes: a slow glow with a shimmer travelling along the veins.
          float breath = 0.55 + 0.45 * sin(uTime * 0.7);
          float travel = 0.6 + 0.4 * sin(vP.x * 9.0 - uTime * 0.9 + mo_noise(vP * 6.0) * 3.0);
          float hot = smoothstep(0.45, 0.95, vVein);
          totalEmissiveRadiance += vec3(1.0, 0.45, 0.12) * hot * (0.12 + 0.55 * breath * travel);`,
          );
      };
      m.customProgramCacheKey = () => "mo-oud-wood";
      m.userData.u = uniforms;
      return m;
    }, []),
  );
}

/** Oil pool with expanding ripples (normal perturbation only; the surface stays flat). */
function usePoolMaterial(color: string) {
  return useDispose(
    useMemo(() => {
      const m = new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.04,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        emissive: color,
        emissiveIntensity: 0.06,
      });
      const uniforms = { uAge: { value: 10 } };
      m.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying vec2 vPool;")
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPool = position.xy;");
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            "#include <common>\nuniform float uAge;\nvarying vec2 vPool;",
          )
          .replace(
            "#include <normal_fragment_maps>",
            `#include <normal_fragment_maps>
          {
            float r = length(vPool);
            float front = uAge * 0.09;
            float env = exp(-uAge * 1.1) * exp(-pow((r - front) / (0.03 + uAge * 0.02), 2.0)) * smoothstep(0.0, 0.08, uAge);
            float slope = cos((r - front) * 160.0) * env * 0.9;
            vec2 dir = r > 1e-4 ? vPool / r : vec2(0.0);
            // Circle lies in local XY (rotated flat), so local Z is "up".
            vec3 nObj = normalize(vec3(-dir * slope, 1.0));
            vec3 nView = normalize((viewMatrix * vec4(nObj.x, nObj.z, -nObj.y, 0.0)).xyz);
            normal = normalize(mix(normal, nView, 0.9));
          }`,
          );
      };
      m.customProgramCacheKey = () => "mo-pool";
      m.userData.u = uniforms;
      return m;
    }, [color]),
  );
}

export function Oud({ wood, accent, smoke }: { wood: string; accent: string; smoke: boolean }) {
  const mode = useSceneMode();
  const woodGeo = useDispose(useMemo(() => buildWood(mode.low), [mode.low]));
  const woodMat = useWoodMaterial();
  const carved = useEngravedBrass("#2b1b12", 1, 0, 0.55);
  const gold = useGold(accent, 0.2);
  const oil = useMemo(
    () => new THREE.Color("#c8862a").lerp(new THREE.Color(accent), 0.3).getStyle(),
    [accent],
  );
  const pool = usePoolMaterial(oil);

  const tray = useDispose(
    useMemo(() => {
      const g = lathe(
        [
          [0, 0],
          [0.62, 0],
          [0.7, 0.012],
          [0.76, 0.05],
          [0.785, 0.075],
          [0.79, 0.09],
          [0.775, 0.094],
          [0.74, 0.06],
          [0.66, 0.03],
          [0.58, 0.022],
          [0, 0.022],
        ],
        192,
      );
      // Scalloped, hand-raised rim.
      const p = g.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const z = p.getZ(i);
        const r = Math.hypot(x, z);
        if (r < 0.66) continue;
        const a = Math.atan2(z, x);
        const k = 1 + Math.cos(a * 18) * 0.018 * ((r - 0.66) / 0.13);
        p.setX(i, x * k);
        p.setZ(i, z * k);
      }
      g.computeVertexNormals();
      return g;
    }, []),
  );
  const dish = useDispose(
    useMemo(
      () =>
        lathe(
          [
            [0, 0],
            [0.1, 0],
            [0.13, 0.012],
            [0.155, 0.045],
            [0.16, 0.055],
            [0.152, 0.057],
            [0.14, 0.04],
            [0.11, 0.022],
            [0, 0.022],
          ],
          96,
        ),
      [],
    ),
  );
  const glassTube = useDispose(
    useMemo(
      () =>
        lathe(
          [
            [0.0, 0],
            [0.006, 0],
            [0.008, 0.01],
            [0.02, 0.07],
            [0.026, 0.11],
            [0.026, 0.3],
            [0.024, 0.31],
            [0, 0.31],
          ],
          48,
        ),
      [],
    ),
  );
  const oilInTube = useDispose(
    useMemo(
      () =>
        lathe(
          [
            [0, 0.012],
            [0.006, 0.012],
            [0.016, 0.07],
            [0.021, 0.11],
            [0.021, 0.21],
            [0, 0.21],
          ],
          32,
        ),
      [],
    ),
  );
  const bulbGeo = useDispose(
    useMemo(
      () =>
        lathe(
          [
            [0, 0],
            [0.03, 0],
            [0.034, 0.02],
            [0.036, 0.06],
            [0.03, 0.1],
            [0.018, 0.12],
            [0, 0.124],
          ],
          48,
        ),
      [],
    ),
  );

  const glass = useDispose(
    useMemo(
      () =>
        clearGlass(
          new THREE.MeshPhysicalMaterial({
            color: "#ffffff",
            transmission: 1,
            thickness: 0.05,
            roughness: 0.03,
            ior: 1.5,
            clearcoat: 1,
            envMapIntensity: 1.3,
          }),
          0.08,
        ),
      [],
    ),
  );
  const oilMat = useDispose(
    useMemo(
      () =>
        new THREE.MeshPhysicalMaterial({
          color: oil,
          roughness: 0.08,
          clearcoat: 1,
          emissive: oil,
          emissiveIntensity: 0.1,
        }),
      [oil],
    ),
  );
  const dropMat = useDispose(
    useMemo(
      () =>
        clearGlass(
          new THREE.MeshPhysicalMaterial({
            color: oil,
            roughness: 0.02,
            clearcoat: 1,
            transmission: 0.5,
            thickness: 0.04,
            ior: 1.47,
            attenuationColor: new THREE.Color(oil),
            attenuationDistance: 0.05,
            emissive: oil,
            emissiveIntensity: 0.35,
          }),
          0.9,
        ),
      [oil],
    ),
  );

  const drop = useRef<THREE.Mesh>(null);
  const pipette = useRef<THREE.Group>(null);
  const emberGlow = useRef<THREE.Mesh>(null);
  const woodMesh = useRef<THREE.Mesh>(null);
  const poolMesh = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    const t = sceneTime(state.clock, mode, 4.2);
    const wu = uniformsOf(woodMesh.current);
    if (wu) wu.uTime.value = t;
    const ph = ((t % DROP_PERIOD) + DROP_PERIOD) % DROP_PERIOD;
    const impact = NECK_END + FALL;
    // Ripple age since the last impact (wraps into the next cycle).
    const pu = uniformsOf(poolMesh.current);
    if (pu) pu.uAge.value = ph >= impact ? ph - impact : ph + DROP_PERIOD - impact;
    if (pipette.current) pipette.current.position.y = Math.sin(t * 0.9) * 0.004;
    const d = drop.current;
    if (d) {
      const tipY = TIP_Y + (pipette.current?.position.y ?? 0);
      if (ph < FORM_END) {
        const g = Math.pow(ph / FORM_END, 0.7);
        d.visible = ph > 0.15;
        d.scale.set(g, g * 1.05, g);
        d.position.set(0, tipY - 0.018 * g, 0);
      } else if (ph < NECK_END) {
        const s = (ph - FORM_END) / (NECK_END - FORM_END);
        d.visible = true;
        d.scale.set(1 - s * 0.08, 1.05 + s * 0.45, 1 - s * 0.08);
        d.position.set(0, tipY - 0.018 - s * 0.02, 0);
      } else if (ph < impact) {
        const s = ph - NECK_END;
        d.visible = true;
        d.scale.set(0.95, 1.25 - s * 0.8, 0.95);
        d.position.set(0, tipY - 0.038 - 0.5 * 4.2 * s * s, 0);
      } else {
        d.visible = false;
      }
    }
    if (emberGlow.current)
      emberGlow.current.scale.setScalar(0.85 + Math.sin(t * 2.3) * 0.1 + Math.sin(t * 5.1) * 0.05);
  });

  return (
    <group position={[0, -0.52, 0]} scale={0.95}>
      <mesh geometry={tray} material={carved} receiveShadow castShadow />
      {/* Brass inlay on the rim and around the well */}
      <mesh material={gold} position={[0, 0.093, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.782, 0.006, 8, 160]} />
      </mesh>
      <mesh material={gold} position={[0, 0.0235, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.6, 0.612, 160]} />
      </mesh>

      {/* Agarwood */}
      <group position={[-0.16, 0.12, -0.08]} rotation={[0, 0.3, 0]} scale={0.82}>
        <mesh ref={woodMesh} geometry={woodGeo} material={woodMat} castShadow receiveShadow />
        {/* Smouldering tip at the splintered end */}
        <Glow
          glowRef={emberGlow}
          position={[0.62, 0.0, 0.0]}
          size={0.09}
          color="#ff6a1f"
          intensity={0.9}
        />
        <mesh position={[0.6, 0.0, 0.0]}>
          <sphereGeometry args={[0.012, 12, 8]} />
          <meshStandardMaterial
            color="#ff8a3d"
            emissive="#ff5a10"
            emissiveIntensity={3}
            toneMapped={false}
          />
        </mesh>
      </group>
      {smoke && (
        <Smoke
          position={[0.325, 0.13, -0.23]}
          height={1.9}
          spread={0.4}
          count={220}
          size={90}
          opacity={0.14}
          color="#d6c0a0"
          warm="#f0cf9c"
          ribbonWidth={0.03}
          ribbonOpacity={0.4}
          seed={5}
        />
      )}

      {/* Oil dish, pool and pipette */}
      <group position={DISH}>
        <mesh geometry={dish} material={gold} position={[0, 0.022, 0]} castShadow />
        <mesh
          ref={poolMesh}
          material={pool}
          position={[0, POOL_Y, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[0.122, 64]} />
        </mesh>
        <group ref={pipette}>
          <group position={[0, TIP_Y, 0]}>
            <mesh geometry={glassTube} material={glass} />
            <mesh geometry={oilInTube} material={oilMat} />
            <mesh material={gold} position={[0, 0.315, 0]}>
              <cylinderGeometry args={[0.03, 0.03, 0.03, 32]} />
            </mesh>
            <mesh geometry={bulbGeo} position={[0, 0.33, 0]} castShadow>
              <meshPhysicalMaterial
                color={new THREE.Color(wood).multiplyScalar(0.6)}
                roughness={0.3}
                clearcoat={1}
                clearcoatRoughness={0.1}
              />
            </mesh>
          </group>
          <mesh ref={drop} material={dropMat} position={[0, TIP_Y, 0]}>
            <sphereGeometry args={[0.021, 24, 16]} />
          </mesh>
        </group>
      </group>
      <pointLight position={[0.46, 0.35, 0.4]} color="#ffb060" intensity={0.25} distance={1.2} />
      <pointLight position={[0.3, 0.25, -0.2]} color="#ff7a2a" intensity={0.2} distance={0.8} />
    </group>
  );
}
