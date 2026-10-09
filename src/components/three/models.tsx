"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Model3D } from "@/generated/prisma/enums";
import { Smoke } from "./smoke";
import { Flame } from "./flame";
import { Coil } from "./coil";
import { Perfume } from "./perfume";
import { Oud } from "./oud";
import {
  Flecks,
  Glow,
  Sparks,
  clearGlass,
  glslNoise,
  lathe,
  sceneTime,
  useDispose,
  useEngravedBrass,
  useGold,
  useGrain,
  useSceneMode,
  uniformsOf,
} from "./shared";

/**
 * All products are modelled procedurally (no asset downloads); colours come from the product palette.
 * Shared building blocks (materials, glow, sparks, scene mode) live in ./shared, smoke in ./smoke.
 */
export function ProductModel({
  model,
  palette,
  smoke = true,
}: {
  model: Model3D;
  palette: string[];
  smoke?: boolean;
}) {
  const [primary = "#2a2420", accent = "#c8a46a"] = palette;
  const { still } = useSceneMode();
  switch (model) {
    case "CANDLE":
      return <Candle body={primary} accent={accent} />;
    case "OIL":
      return <OilBottle glass={primary} accent={accent} />;
    case "INCENSE":
      return <Incense stick={primary} accent={accent} smoke={smoke} />;
    case "DHOOP":
      return <Dhoop cone={primary} accent={accent} smoke={smoke} />;
    case "BAKHOOR":
      return <Bakhoor chip={primary} accent={accent} smoke={smoke} />;
    case "GIFTBOX":
      return <GiftBox body={primary} accent={accent} still={still} />;
    case "CARD":
      return <Card body={primary} accent={accent} still={still} />;
    case "COIL":
      return <Coil color={primary} accent={accent} smoke={smoke} />;
    case "PERFUME":
      return <Perfume juice={primary} accent={accent} />;
    case "OUD":
      return <Oud wood={primary} accent={accent} smoke={smoke} />;
  }
}

/* ---------------------------------------------------------------------------------------------- */

const waxGlowFragment = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  varying vec2 vUv;
  ${glslNoise}
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    float f = 0.85 + 0.1 * sin(uTime * 17.0) + 0.08 * mo_noise(vec3(uTime * 6.0, 0.0, 0.0));
    float a = exp(-r * r * 3.5) * smoothstep(1.0, 0.85, r) * f * uIntensity;
    gl_FragColor = vec4(vec3(1.0, 0.62, 0.28) * a, a);
  }
`;
const uvVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const causticFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  ${glslNoise}
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    // Bright filaments where two drifting noise fields cross zero.
    float a = abs(mo_noise(vec3(p * 5.0, uTime * 0.35)) - 0.5);
    float b = abs(mo_noise(vec3(p * 7.0 + 3.0, uTime * 0.27 + 2.0)) - 0.5);
    float c = pow(1.0 - min(a, b) * 2.0, 14.0);
    float fall = smoothstep(0.75, 0.15, r);
    gl_FragColor = vec4(uColor, c * fall * 0.55);
  }
`;

const glintFragment = /* glsl */ `
  uniform float uSweep;
  varying vec2 vUv;
  void main() {
    // Diagonal band crossing the card face.
    float d = (vUv.x + vUv.y * 0.6) - uSweep;
    float band = exp(-d * d * 90.0);
    gl_FragColor = vec4(vec3(1.0, 0.93, 0.78), band * 0.45);
  }
`;

function Candle({ body, accent }: { body: string; accent: string }) {
  const mode = useSceneMode();
  const vessel = useDispose(
    useMemo(
      () =>
        lathe([
          [0, 0],
          [0.42, 0],
          [0.47, 0.04],
          [0.5, 0.2],
          [0.5, 0.78],
          [0.47, 0.8],
          [0.44, 0.78],
          [0.44, 0.1],
          [0, 0.1],
        ]),
      [],
    ),
  );
  const grain = useGrain(3);
  const wick = useDispose(
    useMemo(() => {
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.002, 0.04, 0),
        new THREE.Vector3(0.008, 0.075, 0.002),
      ]);
      return new THREE.TubeGeometry(curve, 12, 0.0055, 8, false);
    }, []),
  );
  const glow = useDispose(
    useMemo(
      () =>
        new THREE.ShaderMaterial({
          vertexShader: uvVertex,
          fragmentShader: waxGlowFragment,
          uniforms: { uTime: { value: 0 }, uIntensity: { value: 0.75 } },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
      [],
    ),
  );
  const pool = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const u = uniformsOf(pool.current);
    if (u) u.uTime.value = sceneTime(clock, mode, 3.3);
  });
  return (
    <group position={[0, -0.5, 0]}>
      <mesh geometry={vessel} castShadow receiveShadow>
        <meshPhysicalMaterial
          color={body}
          roughness={0.5}
          clearcoat={0.8}
          clearcoatRoughness={0.25}
          sheen={0.4}
          sheenColor={accent}
        />
      </mesh>
      {/* Wax pool: creamy, softly lit from the flame */}
      <mesh position={[0, 0.72, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[0.44, 64]} />
        <meshPhysicalMaterial
          color="#efe4cf"
          roughness={0.32}
          bumpMap={grain}
          bumpScale={0.15}
          emissive="#ff9a4a"
          emissiveIntensity={0.1}
          sheen={0.6}
          sheenColor="#fff2dc"
        />
      </mesh>
      {/* Melted pool around the wick: warm glow that flickers with the flame */}
      <mesh
        ref={pool}
        position={[0, 0.7215, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={glow}
        renderOrder={2}
      >
        <circleGeometry args={[0.3, 48]} />
      </mesh>
      <mesh position={[0, 0.3, 0.505]}>
        <planeGeometry args={[0.36, 0.005]} />
        <meshStandardMaterial color={accent} metalness={1} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.3, 0.505]}>
        <ringGeometry args={[0.03, 0.034, 40]} />
        <meshStandardMaterial color={accent} metalness={1} roughness={0.3} />
      </mesh>
      <mesh geometry={wick} position={[0, 0.715, 0]}>
        <meshStandardMaterial color="#17110d" roughness={0.9} />
      </mesh>
      <mesh position={[0.008, 0.79, 0.002]}>
        <sphereGeometry args={[0.007, 10, 8]} />
        <meshStandardMaterial
          color="#ff8a3d"
          emissive="#ff5a10"
          emissiveIntensity={2.5}
          toneMapped={false}
        />
      </mesh>
      <Flame position={[0.006, 0.785, 0]} />
    </group>
  );
}

function OilBottle({ glass, accent }: { glass: string; accent: string }) {
  const mode = useSceneMode();
  const gold = useGold(accent, 0.2);
  const liquid = useMemo(
    () => new THREE.Color(glass).lerp(new THREE.Color(accent), 0.35),
    [glass, accent],
  );
  const glassMat = useDispose(
    useMemo(
      () =>
        clearGlass(
          new THREE.MeshPhysicalMaterial({
            color: "#ffffff",
            transmission: 1,
            thickness: 0.7,
            roughness: 0.02,
            ior: 1.52,
            dispersion: mode.low ? 0 : 0.4,
            attenuationColor: liquid.clone().lerp(new THREE.Color("#ffffff"), 0.6),
            attenuationDistance: 1.2,
            clearcoat: 1,
            clearcoatRoughness: 0.03,
            specularIntensity: 1,
            envMapIntensity: 1.4,
            flatShading: true,
          }),
        ),
      [liquid, mode.low],
    ),
  );
  const causticMat = useDispose(
    useMemo(
      () =>
        new THREE.ShaderMaterial({
          vertexShader: uvVertex,
          fragmentShader: causticFragment,
          uniforms: {
            uTime: { value: 0 },
            uColor: { value: liquid.clone().lerp(new THREE.Color("#ffd28a"), 0.5) },
          },
          transparent: true,
          depthWrite: false,
        }),
      [liquid],
    ),
  );
  const oil = useRef<THREE.Mesh>(null);
  const caustic = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = sceneTime(clock, mode);
    if (oil.current) {
      oil.current.rotation.z = Math.sin(t * 0.9) * 0.018;
      oil.current.rotation.x = Math.sin(t * 0.7 + 1) * 0.012;
    }
    const u = uniformsOf(caustic.current);
    if (u) u.uTime.value = t;
  });
  return (
    <group position={[0, -0.55, 0]}>
      {/* Faceted octagonal flacon (thick base) */}
      <mesh position={[0, 0.42, 0]} material={glassMat} castShadow>
        <cylinderGeometry args={[0.18, 0.36, 0.84, 8, 1]} />
      </mesh>
      {/* Oil: opaque so it is captured by the glass's refraction pass; it rocks very gently */}
      <mesh ref={oil} position={[0, 0.38, 0]}>
        <cylinderGeometry args={[0.15, 0.29, 0.56, 8, 1]} />
        <meshPhysicalMaterial
          color={liquid}
          roughness={0.1}
          clearcoat={1}
          emissive={liquid}
          emissiveIntensity={0.18}
          flatShading
        />
      </mesh>
      {/* Gold dabber rod reaching into the oil */}
      <mesh material={gold} position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.008, 0.004, 0.6, 12]} />
      </mesh>
      <mesh position={[0, 0.9, 0]} material={gold}>
        <cylinderGeometry args={[0.07, 0.09, 0.14, 32]} />
      </mesh>
      {[0.86, 0.94].map((y) => (
        <mesh key={y} position={[0, y, 0]} material={gold} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.083 - (y - 0.86) * 0.15, 0.005, 8, 40]} />
        </mesh>
      ))}
      <mesh position={[0, 1.0, 0]} material={gold} castShadow>
        <sphereGeometry args={[0.11, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.6]} />
      </mesh>
      <mesh position={[0, 1.12, 0]} material={gold}>
        <coneGeometry args={[0.03, 0.18, 24]} />
      </mesh>
      {/* Light focused through the oil: drifting amber caustics on the surface below */}
      <mesh
        ref={caustic}
        position={[0.12, -0.065, 0.1]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={causticMat}
        renderOrder={1}
      >
        <planeGeometry args={[1.1, 1.1]} />
      </mesh>
    </group>
  );
}

/** Glowing ember tip: emissive bead + halo, pulsing gently. */
function Ember({ position, size = 0.012 }: { position: [number, number, number]; size?: number }) {
  const mode = useSceneMode();
  const ref = useRef<THREE.MeshStandardMaterial>(null);
  const halo = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = sceneTime(clock, mode);
    const p =
      Math.sin(t * 2.6 + position[0] * 30) * 0.5 + Math.sin(t * 6.1 + position[2] * 20) * 0.25;
    if (ref.current) ref.current.emissiveIntensity = 3 + p;
    if (halo.current) halo.current.scale.setScalar(0.9 + p * 0.12);
  });
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[size, 14, 10]} />
        <meshStandardMaterial
          ref={ref}
          color="#ff8a3d"
          emissive="#ff5a10"
          emissiveIntensity={3}
          toneMapped={false}
        />
      </mesh>
      <Glow glowRef={halo} size={size * 8} color="#ff6a1f" intensity={0.9} />
    </group>
  );
}

function Incense({ stick, accent, smoke }: { stick: string; accent: string; smoke: boolean }) {
  const brass = useEngravedBrass(accent, 0.4);
  const grain = useGrain(1, 10);
  const sticks = useMemo(
    () =>
      [
        { rot: -0.22, h: 1.15, tone: 0.92 },
        { rot: 0.0, h: 1.3, tone: 1 },
        { rot: 0.18, h: 1.05, tone: 1.08 },
      ].map((s) => ({ ...s, color: new THREE.Color(stick).multiplyScalar(s.tone) })),
    [stick],
  );
  const bamboo = useMemo(
    () => new THREE.Color(accent).lerp(new THREE.Color("#7a5a36"), 0.6),
    [accent],
  );
  return (
    <group position={[0, -0.6, 0]}>
      {/* Engraved brass holder with a raised boss */}
      <mesh position={[0, 0.04, 0]} material={brass} castShadow receiveShadow>
        <cylinderGeometry args={[0.32, 0.36, 0.08, 96]} />
      </mesh>
      <mesh position={[0, 0.09, 0]} material={brass} castShadow>
        <cylinderGeometry args={[0.06, 0.09, 0.03, 48]} />
      </mesh>
      {sticks.map((s, i) => {
        const coat = s.h * 0.72;
        const tipL = s.h * 0.98;
        const tip: [number, number, number] = [
          Math.sin(s.rot) * tipL,
          0.1 + Math.cos(s.rot) * tipL,
          (i - 1) * 0.04,
        ];
        return (
          <group key={i}>
            <group rotation={[0, 0, -s.rot]} position={[0, 0.1, (i - 1) * 0.04]}>
              {/* Bamboo core */}
              <mesh position={[0, s.h * 0.5, 0]}>
                <cylinderGeometry args={[0.0055, 0.0065, s.h, 8]} />
                <meshStandardMaterial color={bamboo} roughness={0.6} />
              </mesh>
              {/* Hand-rolled masala coat: grainy, slightly uneven */}
              <mesh position={[0, s.h * 0.62 - 0.02, 0]} castShadow>
                <cylinderGeometry args={[0.017, 0.019, coat - 0.04, 14, 1]} />
                <meshStandardMaterial
                  color={s.color}
                  roughness={0.95}
                  bumpMap={grain}
                  bumpScale={2}
                  roughnessMap={grain}
                />
              </mesh>
              {/* Ash tip */}
              <mesh position={[0, s.h * 0.62 + coat / 2 - 0.02, 0]}>
                <cylinderGeometry args={[0.012, 0.017, 0.04, 14, 1]} />
                <meshStandardMaterial color="#9d968c" roughness={1} bumpMap={grain} bumpScale={3} />
              </mesh>
            </group>
            <Ember position={tip} size={0.011} />
            {i === 1 && <Sparks origin={tip} count={6} rate={0.1} />}
            {i === 1 && <Flecks origin={tip} count={7} fall={tip[1] - 0.12} />}
            {smoke && i === 1 && (
              <Smoke position={tip} height={2.2} ribbonWidth={0.03} ribbonOpacity={0.55} />
            )}
          </group>
        );
      })}
      <pointLight position={[0, 1.3, 0.05]} color="#ff7a2a" intensity={0.35} distance={1.2} />
    </group>
  );
}

function Dhoop({ cone, accent, smoke }: { cone: string; accent: string; smoke: boolean }) {
  const brass = useEngravedBrass(accent, 0.65);
  const grain = useGrain(3, 3);
  const cones: [number, number, number][] = [
    [-0.24, 0.12, 0.05],
    [0, 0.14, -0.08],
    [0.24, 0.12, 0.06],
  ];
  return (
    <group position={[0, -0.45, 0]}>
      <mesh material={brass} receiveShadow castShadow>
        <cylinderGeometry args={[0.6, 0.52, 0.06, 96]} />
      </mesh>
      {cones.map((p, i) => {
        const h = 0.22 - i * 0.01;
        return (
          <group key={i} position={p}>
            <mesh castShadow receiveShadow>
              <coneGeometry args={[0.09, h, 40]} />
              <meshStandardMaterial color={cone} roughness={1} bumpMap={grain} bumpScale={2.5} />
            </mesh>
            {i === 1 && (
              <>
                {/* Ash cap and glowing tip */}
                <mesh position={[0, h / 2 - 0.022, 0]}>
                  <coneGeometry args={[0.019, 0.045, 24]} />
                  <meshStandardMaterial
                    color="#a39a8e"
                    roughness={1}
                    bumpMap={grain}
                    bumpScale={3}
                  />
                </mesh>
                <Ember position={[0, h / 2 - 0.045, 0]} size={0.014} />
                <Flecks origin={[0, h / 2 - 0.03, 0]} count={5} fall={h / 2 + 0.02} />
              </>
            )}
          </group>
        );
      })}
      {smoke && (
        <Smoke
          position={[0, 0.205, -0.08]}
          height={2}
          spread={0.45}
          count={360}
          ribbonWidth={0.045}
          ribbonOpacity={0.5}
          seed={2}
        />
      )}
    </group>
  );
}

const coalVertex = uvVertex;
const coalFragment = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  ${glslNoise}
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    // Charcoal with glowing fissures that slowly breathe and crawl.
    float n = mo_fbm(vec3(p * 5.0, uTime * 0.08));
    float cracks = smoothstep(0.06, 0.0, abs(n - 0.5));
    float heat = 0.55 + 0.45 * sin(uTime * 0.9 + n * 6.0);
    vec3 coal = vec3(0.06, 0.05, 0.045) * (0.7 + 0.6 * mo_noise(vec3(p * 30.0, 1.0)));
    vec3 ash = vec3(0.55, 0.52, 0.48) * smoothstep(0.55, 0.75, mo_noise(vec3(p * 9.0, 4.0)));
    vec3 glow = vec3(1.0, 0.35, 0.06) * cracks * heat * 2.6 + vec3(1.0, 0.25, 0.04) * 0.25 * heat;
    vec3 col = mix(coal, ash, 0.5) + glow;
    gl_FragColor = vec4(col, smoothstep(1.0, 0.96, r));
  }
`;

function Bakhoor({ chip, accent, smoke }: { chip: string; accent: string; smoke: boolean }) {
  const mode = useSceneMode();
  const gold = useGold(accent);
  const brass = useEngravedBrass(accent, 0.45);
  const bowl = useDispose(
    useMemo(
      () =>
        lathe([
          [0, 0],
          [0.18, 0],
          [0.38, 0.12],
          [0.46, 0.26],
          [0.42, 0.27],
          [0.34, 0.15],
          [0.16, 0.05],
          [0, 0.05],
        ]),
      [],
    ),
  );
  const chips = useMemo(
    () =>
      Array.from({ length: 11 }, (_, i) => ({
        pos: [
          Math.cos(i * 2.4) * 0.2 * Math.sqrt(i / 11),
          0.19 + (i % 3) * 0.006,
          Math.sin(i * 2.4) * 0.2 * Math.sqrt(i / 11),
        ] as [number, number, number],
        rot: i * 0.7,
        hot: i % 3 === 0,
        s: 0.8 + (i % 4) * 0.12,
      })),
    [],
  );
  const coal = useDispose(
    useMemo(
      () =>
        new THREE.ShaderMaterial({
          vertexShader: coalVertex,
          fragmentShader: coalFragment,
          uniforms: { uTime: { value: 0 } },
          transparent: true,
          toneMapped: false,
        }),
      [],
    ),
  );
  const light = useRef<THREE.PointLight>(null);
  const bed = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = sceneTime(clock, mode);
    const u = uniformsOf(bed.current);
    if (u) u.uTime.value = t;
    if (light.current)
      light.current.intensity = 1.2 + Math.sin(t * 0.9) * 0.25 + Math.sin(t * 5.3) * 0.08;
  });
  return (
    <group position={[0, -0.6, 0]}>
      <mesh material={brass} position={[0, 0.06, 0]} castShadow>
        <boxGeometry args={[0.5, 0.12, 0.5]} />
      </mesh>
      <mesh material={gold} position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.06, 0.1, 0.36, 32]} />
      </mesh>
      {[0.14, 0.46].map((y) => (
        <mesh key={y} material={gold} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[y < 0.3 ? 0.1 : 0.065, 0.012, 10, 40]} />
        </mesh>
      ))}
      <mesh geometry={bowl} material={brass} position={[0, 0.48, 0]} castShadow />
      <group position={[0, 0.5, 0]}>
        {/* Glowing charcoal bed */}
        <mesh ref={bed} position={[0, 0.172, 0]} rotation={[-Math.PI / 2, 0, 0]} material={coal}>
          <circleGeometry args={[0.31, 48]} />
        </mesh>
        {chips.map((c, i) => (
          <mesh key={i} position={c.pos} rotation={[0.3, c.rot, 0.2]} scale={c.s} castShadow>
            <boxGeometry args={[0.07, 0.025, 0.04]} />
            <meshStandardMaterial
              color={chip}
              roughness={0.5}
              emissive={c.hot ? "#ff5a10" : "#000"}
              emissiveIntensity={c.hot ? 1.6 : 0}
              toneMapped={!c.hot}
            />
          </mesh>
        ))}
        <Glow position={[0, 0.2, 0]} size={0.9} color="#ff6a1f" intensity={0.28} />
        <Sparks origin={[0, 0.2, 0]} count={14} rate={0.18} />
        <pointLight
          ref={light}
          position={[0, 0.3, 0]}
          color="#ff7a2a"
          intensity={1.2}
          distance={2}
        />
        {smoke && (
          <Smoke
            position={[0, 0.2, 0]}
            height={2}
            spread={0.5}
            count={480}
            opacity={0.24}
            ribbonWidth={0.07}
            ribbonOpacity={0.35}
            seed={4}
          />
        )}
      </group>
    </group>
  );
}

/** Gift card: a thick, gold-edged card that slowly turns to catch the light. */
function Card({ body, accent, still }: { body: string; accent: string; still: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const glint = useRef<THREE.Mesh>(null);
  const gold = useGold(accent);
  const glintMat = useDispose(
    useMemo(
      () =>
        new THREE.ShaderMaterial({
          vertexShader: uvVertex,
          fragmentShader: glintFragment,
          uniforms: { uSweep: { value: -1 } },
          transparent: true,
          depthWrite: false,
        }),
      [],
    ),
  );
  useFrame(({ clock }) => {
    if (ref.current)
      ref.current.rotation.y = still ? -0.35 : Math.sin(clock.elapsedTime * 0.5) * 0.5;
    // A band of light sweeps across the foil every few seconds.
    const u = uniformsOf(glint.current);
    if (u) u.uSweep.value = still ? 0.35 : ((clock.elapsedTime % 4.5) / 4.5) * 3 - 1;
  });
  return (
    <group ref={ref} rotation={[0.15, 0, -0.08]}>
      <mesh castShadow>
        <boxGeometry args={[1.6, 1, 0.03]} />
        <meshPhysicalMaterial
          color={body}
          roughness={0.35}
          clearcoat={1}
          clearcoatRoughness={0.15}
        />
      </mesh>
      {/* Foil edge and a foil band across the face */}
      <mesh material={gold}>
        <boxGeometry args={[1.62, 1.02, 0.026]} />
      </mesh>
      <mesh material={gold} position={[0, 0.18, 0.017]} rotation={[0, 0, 0.12]}>
        <planeGeometry args={[1.7, 0.08]} />
      </mesh>
      <mesh material={gold} position={[0.56, -0.28, 0.017]}>
        <ringGeometry args={[0.09, 0.1, 48]} />
      </mesh>
      <mesh ref={glint} material={glintMat} position={[0, 0, 0.0185]} renderOrder={2}>
        <planeGeometry args={[1.6, 1]} />
      </mesh>
    </group>
  );
}

function GiftBox({ body, accent, still }: { body: string; accent: string; still: boolean }) {
  const lid = useRef<THREE.Group>(null);
  const glow = useRef<THREE.PointLight>(null);
  const tissue = useRef<THREE.MeshStandardMaterial>(null);
  const gold = useGold(accent);
  const tissueGeo = useDispose(
    useMemo(() => {
      // Crumpled tissue puffing out of the box mouth.
      const g = new THREE.PlaneGeometry(0.92, 0.72, 24, 18);
      const p = g.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const edge = Math.min(1, Math.min(0.46 - Math.abs(x), 0.36 - Math.abs(y)) * 8);
        p.setZ(
          i,
          (Math.sin(x * 23) * Math.cos(y * 19) * 0.018 + Math.sin(x * 9 + y * 7) * 0.03) * edge +
            edge * 0.05,
        );
      }
      g.computeVertexNormals();
      return g;
    }, []),
  );
  // UNBOX: the lid breathes open and closed; light from the tissue swells as it opens.
  useFrame(({ clock }) => {
    if (!lid.current) return;
    const t = still ? 0.6 : (Math.sin(clock.elapsedTime * 0.8) + 1) / 2;
    lid.current.position.y = 0.62 + t * 0.32;
    lid.current.rotation.z = t * 0.12;
    if (glow.current) glow.current.intensity = 0.3 + t * 1.1;
    if (tissue.current) tissue.current.emissiveIntensity = 0.08 + t * 0.35;
  });
  return (
    <group position={[0, -0.45, 0]}>
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[1, 0.6, 0.8]} />
        <meshPhysicalMaterial
          color={body}
          roughness={0.6}
          sheen={1}
          sheenColor={accent}
          sheenRoughness={0.6}
        />
      </mesh>
      <mesh position={[0, 0.3, 0]} material={gold}>
        <boxGeometry args={[0.1, 0.602, 0.802]} />
      </mesh>
      {/* Tissue paper and its glow from inside */}
      <mesh
        geometry={tissueGeo}
        position={[0, 0.6, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <meshStandardMaterial
          ref={tissue}
          color="#f3e7d2"
          roughness={0.85}
          emissive={accent}
          emissiveIntensity={0.2}
          side={THREE.DoubleSide}
        />
      </mesh>
      <pointLight ref={glow} position={[0, 0.7, 0]} color={accent} intensity={0.8} distance={1.5} />
      <group ref={lid}>
        <mesh castShadow>
          <boxGeometry args={[1.06, 0.14, 0.86]} />
          <meshPhysicalMaterial color={body} roughness={0.55} sheen={1} sheenColor={accent} />
        </mesh>
        <mesh material={gold}>
          <boxGeometry args={[0.1, 0.142, 0.862]} />
        </mesh>
        <mesh material={gold} position={[0, 0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.1, 0.025, 12, 32]} />
        </mesh>
      </group>
    </group>
  );
}
