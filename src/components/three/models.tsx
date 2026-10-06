"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Model3D } from "@/generated/prisma/enums";
import { Smoke } from "./smoke";
import { Flame } from "./flame";

/** All products are modelled procedurally (no asset downloads); colours come from the product palette. */
export function ProductModel({ model, palette, smoke = true }: { model: Model3D; palette: string[]; smoke?: boolean }) {
  const [primary = "#2a2420", accent = "#c8a46a"] = palette;
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
      return <GiftBox body={primary} accent={accent} />;
    case "CARD":
      return <Card body={primary} accent={accent} />;
  }
}

function useGold(accent: string) {
  return useMemo(() => new THREE.MeshStandardMaterial({ color: accent, metalness: 1, roughness: 0.28 }), [accent]);
}

function lathe(points: [number, number][], segments = 96) {
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), segments);
}

function Candle({ body, accent }: { body: string; accent: string }) {
  const vessel = useMemo(() => lathe([[0, 0], [0.42, 0], [0.47, 0.04], [0.5, 0.2], [0.5, 0.78], [0.47, 0.8], [0.44, 0.78], [0.44, 0.1], [0, 0.1]]), []);
  return (
    <group position={[0, -0.5, 0]}>
      <mesh geometry={vessel} castShadow receiveShadow>
        <meshPhysicalMaterial color={body} roughness={0.55} clearcoat={0.6} clearcoatRoughness={0.4} />
      </mesh>
      {/* Wax pool */}
      <mesh position={[0, 0.72, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.44, 64]} />
        <meshStandardMaterial color="#efe4cf" roughness={0.35} emissive="#ff9a4a" emissiveIntensity={0.08} />
      </mesh>
      <mesh position={[0, 0.3, 0.505]}>
        <planeGeometry args={[0.36, 0.005]} />
        <meshStandardMaterial color={accent} metalness={1} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.76, 0]}>
        <cylinderGeometry args={[0.006, 0.006, 0.08]} />
        <meshStandardMaterial color="#1a1410" />
      </mesh>
      <Flame position={[0, 0.79, 0]} />
    </group>
  );
}

function OilBottle({ glass, accent }: { glass: string; accent: string }) {
  const gold = useGold(accent);
  const liquid = useMemo(() => new THREE.Color(glass).lerp(new THREE.Color(accent), 0.35), [glass, accent]);
  return (
    <group position={[0, -0.55, 0]}>
      {/* Faceted octagonal flacon */}
      <mesh position={[0, 0.42, 0]} castShadow>
        <cylinderGeometry args={[0.18, 0.36, 0.84, 8, 1]} />
        <meshPhysicalMaterial color="#ffffff" transmission={1} thickness={0.6} roughness={0.04} ior={1.5} attenuationColor={liquid} attenuationDistance={0.45} flatShading />
      </mesh>
      <mesh position={[0, 0.36, 0]}>
        <cylinderGeometry args={[0.15, 0.31, 0.62, 8, 1]} />
        <meshStandardMaterial color={liquid} roughness={0.2} transparent opacity={0.75} flatShading />
      </mesh>
      <mesh position={[0, 0.9, 0]} material={gold}>
        <cylinderGeometry args={[0.07, 0.09, 0.14, 24]} />
      </mesh>
      <mesh position={[0, 1.08, 0]} material={gold} castShadow>
        <sphereGeometry args={[0.11, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.6]} />
      </mesh>
      <mesh position={[0, 1.2, 0]} material={gold}>
        <coneGeometry args={[0.03, 0.18, 16]} />
      </mesh>
    </group>
  );
}

function Ember({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.emissiveIntensity = 3 + Math.sin(clock.elapsedTime * 9 + position[0] * 30) * 0.8;
  });
  return (
    <mesh position={position}>
      <sphereGeometry args={[0.012, 12, 12]} />
      <meshStandardMaterial ref={ref} color="#ff8a3d" emissive="#ff6a1a" emissiveIntensity={3} toneMapped={false} />
    </mesh>
  );
}

function Incense({ stick, accent, smoke }: { stick: string; accent: string; smoke: boolean }) {
  const gold = useGold(accent);
  const sticks: { rot: number; h: number }[] = [
    { rot: -0.22, h: 1.15 },
    { rot: 0.0, h: 1.3 },
    { rot: 0.18, h: 1.05 },
  ];
  return (
    <group position={[0, -0.6, 0]}>
      <mesh position={[0, 0.04, 0]} material={gold} castShadow receiveShadow>
        <cylinderGeometry args={[0.32, 0.36, 0.08, 64]} />
      </mesh>
      {sticks.map((s, i) => {
        const tip: [number, number, number] = [Math.sin(s.rot) * s.h, 0.08 + Math.cos(s.rot) * s.h, (i - 1) * 0.04];
        return (
          <group key={i}>
            <group rotation={[0, 0, -s.rot]} position={[0, 0.08, (i - 1) * 0.04]}>
              <mesh position={[0, s.h * 0.5, 0]}>
                <cylinderGeometry args={[0.006, 0.006, s.h, 8]} />
                <meshStandardMaterial color={new THREE.Color(accent).multiplyScalar(0.5)} />
              </mesh>
              <mesh position={[0, s.h * 0.62, 0]} castShadow>
                <cylinderGeometry args={[0.018, 0.018, s.h * 0.72, 12]} />
                <meshStandardMaterial color={stick} roughness={0.95} />
              </mesh>
            </group>
            <Ember position={tip} />
            {smoke && i === 1 && <Smoke position={tip} height={2.2} />}
          </group>
        );
      })}
    </group>
  );
}

function Dhoop({ cone, accent, smoke }: { cone: string; accent: string; smoke: boolean }) {
  const gold = useGold(accent);
  const cones: [number, number, number][] = [
    [-0.24, 0.12, 0.05],
    [0, 0.14, -0.08],
    [0.24, 0.12, 0.06],
  ];
  return (
    <group position={[0, -0.45, 0]}>
      <mesh material={gold} receiveShadow castShadow>
        <cylinderGeometry args={[0.6, 0.52, 0.06, 64]} />
      </mesh>
      {cones.map((p, i) => (
        <group key={i} position={p}>
          <mesh castShadow>
            <coneGeometry args={[0.09, 0.22 - i * 0.01, 32]} />
            <meshStandardMaterial color={cone} roughness={1} />
          </mesh>
          {i === 1 && <Ember position={[0, 0.11, 0]} />}
        </group>
      ))}
      {smoke && <Smoke position={[0, 0.26, -0.08]} height={2} spread={0.45} count={360} />}
    </group>
  );
}

function Bakhoor({ chip, accent, smoke }: { chip: string; accent: string; smoke: boolean }) {
  const gold = useGold(accent);
  const bowl = useMemo(() => lathe([[0, 0], [0.18, 0], [0.38, 0.12], [0.46, 0.26], [0.42, 0.27], [0.34, 0.15], [0.16, 0.05], [0, 0.05]]), []);
  const chips = useMemo(
    () => Array.from({ length: 9 }, (_, i) => ({ pos: [Math.cos(i * 2.4) * 0.16 * Math.sqrt(i / 9), 0.2, Math.sin(i * 2.4) * 0.16 * Math.sqrt(i / 9)] as [number, number, number], rot: i * 0.7, hot: i % 3 === 0 })),
    [],
  );
  return (
    <group position={[0, -0.6, 0]}>
      <mesh material={gold} position={[0, 0.06, 0]} castShadow>
        <boxGeometry args={[0.5, 0.12, 0.5]} />
      </mesh>
      <mesh material={gold} position={[0, 0.3, 0]}>
        <cylinderGeometry args={[0.06, 0.1, 0.36, 24]} />
      </mesh>
      <mesh geometry={bowl} material={gold} position={[0, 0.48, 0]} castShadow />
      <group position={[0, 0.5, 0]}>
        <mesh position={[0, 0.16, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 0.02, 32]} />
          <meshStandardMaterial color="#1a1210" emissive="#ff4a10" emissiveIntensity={0.6} roughness={1} />
        </mesh>
        {chips.map((c, i) => (
          <mesh key={i} position={c.pos} rotation={[0.3, c.rot, 0.2]}>
            <boxGeometry args={[0.07, 0.025, 0.04]} />
            <meshStandardMaterial color={chip} emissive={c.hot ? "#ff6a1a" : "#000"} emissiveIntensity={c.hot ? 2.2 : 0} toneMapped={!c.hot} />
          </mesh>
        ))}
        <pointLight position={[0, 0.3, 0]} color="#ff7a2a" intensity={1.2} distance={2} />
        {smoke && <Smoke position={[0, 0.22, 0]} height={2} spread={0.5} count={520} opacity={0.26} />}
      </group>
    </group>
  );
}

/** Gift card: a thick, gold-edged card that slowly turns to catch the light. */
function Card({ body, accent }: { body: string; accent: string }) {
  const ref = useRef<THREE.Group>(null);
  const gold = useGold(accent);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = Math.sin(clock.elapsedTime * 0.5) * 0.5;
  });
  return (
    <group ref={ref} rotation={[0.15, 0, -0.08]}>
      <mesh castShadow>
        <boxGeometry args={[1.6, 1, 0.03]} />
        <meshPhysicalMaterial color={body} roughness={0.35} clearcoat={1} clearcoatRoughness={0.15} />
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
    </group>
  );
}

function GiftBox({ body, accent }: { body: string; accent: string }) {
  const lid = useRef<THREE.Group>(null);
  const gold = useGold(accent);
  // UNBOX: the lid breathes open and closed.
  useFrame(({ clock }) => {
    if (!lid.current) return;
    const t = (Math.sin(clock.elapsedTime * 0.8) + 1) / 2;
    lid.current.position.y = 0.62 + t * 0.32;
    lid.current.rotation.z = t * 0.12;
  });
  return (
    <group position={[0, -0.45, 0]}>
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <boxGeometry args={[1, 0.6, 0.8]} />
        <meshPhysicalMaterial color={body} roughness={0.6} sheen={1} sheenColor={accent} sheenRoughness={0.6} />
      </mesh>
      <mesh position={[0, 0.3, 0]} material={gold}>
        <boxGeometry args={[0.1, 0.602, 0.802]} />
      </mesh>
      {/* Tissue glow from inside */}
      <pointLight position={[0, 0.65, 0]} color={accent} intensity={0.8} distance={1.5} />
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
