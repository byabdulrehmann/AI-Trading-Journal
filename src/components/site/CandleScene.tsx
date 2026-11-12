"use client";

import { Environment, Lightformer } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

/**
 * The hero's candle field and the closing mark, one WebGL scene. Scroll progress arrives through a ref (read every
 * frame, never through React state), so scrolling never re-renders the tree.
 *
 * Every candle is generated here from a seeded random walk: they are drawings of the idea of a market, not prices.
 */
export interface SceneProgress {
  current: number;
}

export type SceneTheme = "light" | "dark";

/**
 * WebGL needs literal colours. Each theme's glass tints and studio colours match the site tokens: the ground is the
 * fog, so the far rows dissolve into the room, and the glass is tinted cool for up candles and rose for down ones.
 */
const LOOK = {
  light: { up: "#b9c9ea", down: "#e6aebb", wick: "#c9ced8", ground: "#e6e9ee", dust: "#7d879b", dustOpacity: 0.32, key: "#ffffff", fill: "#c7d2ee", dark: "#1a2033" },
  dark: { up: "#9fb6ff", down: "#f0a2b4", wick: "#dfe4ee", ground: "#0b0d12", dust: "#c9d4ff", dustOpacity: 0.42, key: "#f3f6ff", fill: "#6f7fc4", dark: "#000000" },
} as const;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Candle {
  x: number;
  y: number;
  z: number;
  body: number;
  wickTop: number;
  wickBottom: number;
  up: boolean;
  phase: number;
  /** Where it goes in the closing mark. */
  mark: THREE.Vector3;
  spin: number;
}

// The Jarvis glyph's rising line, in its 26-unit design space (see Mark in SiteNav).
const MARK_PATH: [number, number][] = [[6, 16.5], [10.5, 11.5], [14, 14.5], [20, 7.5]];

function pointOnPath(t: number): [number, number] {
  const segs = MARK_PATH.slice(1).map((p, i) => [MARK_PATH[i], p] as const);
  const lens = segs.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]));
  let d = t * lens.reduce((a, b) => a + b, 0);
  for (let i = 0; i < segs.length; i++) {
    if (d <= lens[i] || i === segs.length - 1) {
      const k = Math.min(1, d / lens[i]);
      const [a, b] = segs[i];
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
    }
    d -= lens[i];
  }
  return MARK_PATH[MARK_PATH.length - 1];
}

function buildCandles(count: number): Candle[] {
  const r = rng(20261110);
  const rows = Math.max(4, Math.round(count / 24));
  const perRow = Math.ceil(count / rows);
  const out: Candle[] = [];
  for (let row = 0; row < rows; row++) {
    let price = (r() - 0.5) * 2;
    const z = -1.5 - row * 3.4;
    const y0 = -2.4 + row * 0.85 + (r() - 0.5) * 0.8;
    for (let i = 0; i < perRow && out.length < count; i++) {
      // A random walk with a slight drift, so each row reads as a chart rather than scattered boxes.
      const move = (r() - 0.46) * 1.25;
      const open = price;
      const close = price + move;
      price = close;
      const hi = Math.max(open, close) + r() * 0.5;
      const lo = Math.min(open, close) - r() * 0.5;
      const x = (i - perRow / 2) * 0.72 + (row % 2) * 0.36;
      const k = out.length / Math.max(1, count - 1);
      const [px, py] = pointOnPath(k);
      out.push({
        x,
        y: y0 + (open + close) / 2,
        z,
        body: Math.max(0.12, Math.abs(close - open)),
        wickTop: hi - Math.max(open, close),
        wickBottom: Math.min(open, close) - lo,
        up: close >= open,
        phase: r() * Math.PI * 2,
        mark: new THREE.Vector3((px - 13) * 0.46, (13 - py) * 0.46 + 0.9, 2 + (r() - 0.5) * 0.3),
        spin: (r() - 0.5) * 6,
      });
    }
  }
  return out;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function Candles({ mode, progress, count, still, theme }: { mode: "field" | "mark"; progress: SceneProgress; count: number; still: boolean; theme: SceneTheme }) {
  const candles = useMemo(() => buildCandles(count), [count]);
  const bodies = useRef<THREE.InstancedMesh>(null);
  const wicks = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const probe = useMemo(() => new THREE.Vector3(), []);
  // How far each candle has been nudged by the pointer, eased every frame so the field flows rather than jumps.
  const nudge = useMemo(() => new Float32Array(count * 2), [count]);
  const look = LOOK[theme];

  useEffect(() => {
    candles.forEach((c, i) => bodies.current?.setColorAt(i, color.set(c.up ? look.up : look.down)));
    if (bodies.current?.instanceColor) bodies.current.instanceColor.needsUpdate = true;
  }, [candles, color, look]);

  useFrame(({ clock, camera, pointer, size }) => {
    const t = still ? 0 : clock.getElapsedTime();
    // Held still, the close shows the finished mark and the hero its opening frame.
    const p = still ? (mode === "mark" ? 1 : 0) : progress.current;
    const reach = !still && mode === "field" && typeof window !== "undefined" && matchMedia("(pointer: fine)").matches;
    const aspect = size.width / Math.max(1, size.height);
    candles.forEach((c, i) => {
      let x = c.x;
      let y = c.y + Math.sin(t * 0.6 + c.phase) * 0.06;
      let z = c.z;
      let rot = 0;
      let s = 1;
      // The field answers the pointer: candles near it part sideways and lift, like glass in a current.
      let tx = 0;
      let ty = 0;
      if (reach) {
        probe.set(x, y, z).project(camera);
        const dx = (probe.x - pointer.x) * aspect;
        const dy = probe.y - pointer.y;
        const k = Math.max(0, 1 - Math.hypot(dx, dy) / 0.42);
        tx = Math.sign(dx || 1) * k * k * 0.9;
        ty = k * k * 1.3;
      }
      nudge[i * 2] += (tx - nudge[i * 2]) * 0.08;
      nudge[i * 2 + 1] += (ty - nudge[i * 2 + 1]) * 0.08;
      x += nudge[i * 2];
      y += nudge[i * 2 + 1];
      rot += nudge[i * 2] * 0.35;
      if (mode === "field") {
        // The exit: the field falls away under the camera, the nearest rows first.
        const fall = Math.max(0, p - 0.25 - (c.z / -40) * 0.2) / 0.75;
        const f = fall * fall;
        y -= f * 16;
        rot = f * c.spin;
      } else {
        // The close: scattered candles find their place on the mark's rising line.
        const k = ease(Math.min(1, Math.max(0, (p - 0.05 - (i / candles.length) * 0.25) / 0.65)));
        x = THREE.MathUtils.lerp(c.x * 1.4, c.mark.x, k);
        y = THREE.MathUtils.lerp(c.y - 4 + Math.sin(c.phase) * 3, c.mark.y, k) + (1 - k) * Math.sin(t * 0.5 + c.phase) * 0.2;
        z = THREE.MathUtils.lerp(c.z, c.mark.z, k);
        rot = (1 - k) * c.spin;
        s = THREE.MathUtils.lerp(1, 0.55, k);
      }
      tmp.position.set(x, y, z);
      tmp.rotation.set(rot * 0.4, 0, rot);
      tmp.scale.set(0.26 * s, c.body * 1.6 * s, 0.26 * s);
      tmp.updateMatrix();
      bodies.current?.setMatrixAt(i, tmp.matrix);
      const wickH = (c.body + c.wickTop + c.wickBottom) * 1.6 * s;
      tmp.position.set(x, y + ((c.wickTop - c.wickBottom) / 2) * 1.6 * s, z);
      tmp.scale.set(0.035 * s, wickH, 0.035 * s);
      tmp.updateMatrix();
      wicks.current?.setMatrixAt(i, tmp.matrix);
    });
    if (bodies.current) bodies.current.instanceMatrix.needsUpdate = true;
    if (wicks.current) wicks.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      {/* Hyperreal glass: transmissive, a clear coat and a thin-film shimmer, lit by the studio's light panels. */}
      <instancedMesh ref={bodies} args={[undefined, undefined, candles.length]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshPhysicalMaterial transmission={1} thickness={0.9} roughness={0.14} ior={1.48} clearcoat={1} clearcoatRoughness={0.06} iridescence={0.45} iridescenceIOR={1.3} envMapIntensity={1.4} />
      </instancedMesh>
      {/* Polished chrome wicks. */}
      <instancedMesh ref={wicks} args={[undefined, undefined, candles.length]} frustumCulled={false}>
        <cylinderGeometry args={[0.5, 0.5, 1, 12]} />
        <meshStandardMaterial color={look.wick} metalness={1} roughness={0.14} envMapIntensity={1.6} />
      </instancedMesh>
    </>
  );
}

function Dust({ count, still, theme }: { count: number; still: boolean; theme: SceneTheme }) {
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const r = rng(7);
    const a = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      a[i * 3] = (r() - 0.5) * 40;
      a[i * 3 + 1] = (r() - 0.5) * 18;
      a[i * 3 + 2] = -r() * 36 + 6;
    }
    return a;
  }, [count]);
  useFrame((_, dt) => {
    if (still || !ref.current) return;
    ref.current.rotation.y += dt * 0.008;
    ref.current.position.y = (ref.current.position.y + dt * 0.05) % 2;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.04} color={LOOK[theme].dust} transparent opacity={LOOK[theme].dustOpacity} sizeAttenuation depthWrite={false} />
    </points>
  );
}

function Rig({ mode, progress, still }: { mode: "field" | "mark"; progress: SceneProgress; still: boolean }) {
  const look = useMemo(() => new THREE.Vector3(), []);
  // The camera is three.js state, moved from the frame callback rather than through a hook's return value.
  useFrame(({ clock, camera, pointer }) => {
    // Held still, the close shows the finished mark and the hero its opening frame.
    const p = still ? (mode === "mark" ? 1 : 0) : progress.current;
    const t = still ? 0 : clock.getElapsedTime();
    const fine = typeof window !== "undefined" && matchMedia("(pointer: fine)").matches && !still;
    const px = fine ? pointer.x : 0;
    const py = fine ? pointer.y : 0;
    if (mode === "field") {
      // A slow push through the field, then the camera tips down as it falls away.
      const z = 11 - p * 6;
      camera.position.x += (px * 1.2 + Math.sin(t * 0.08) * 0.6 - camera.position.x) * 0.04;
      camera.position.y += (1.2 + py * 0.6 - p * 1.5 - camera.position.y) * 0.04;
      camera.position.z += (z - camera.position.z) * 0.08;
      look.set(0, -0.6 - p * 4, -12);
    } else {
      camera.position.x += (px * 0.8 - camera.position.x) * 0.04;
      camera.position.y += (0.6 + py * 0.4 - camera.position.y) * 0.04;
      camera.position.z += (13 - p * 2 - camera.position.z) * 0.06;
      look.set(0, 0.4, 0);
    }
    camera.lookAt(look);
  });
  return null;
}

export default function CandleScene({ mode, progress, active, still, compact, theme }: { mode: "field" | "mark"; progress: SceneProgress; active: boolean; still: boolean; compact: boolean; theme: SceneTheme }) {
  const count = compact ? (mode === "mark" ? 60 : 90) : mode === "mark" ? 84 : 150;
  const look = LOOK[theme];
  return (
    <Canvas
      dpr={[1, compact ? 1.5 : 1.75]}
      frameloop={active ? (still ? "demand" : "always") : "never"}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping }}
      camera={{ position: [0, 1.2, 11], fov: compact ? 58 : 46, near: 0.1, far: 80 }}
      aria-hidden
      data-testid={`scene-${mode}`}
    >
      <fog attach="fog" args={[look.ground, mode === "field" ? 9 : 11, mode === "field" ? 30 : 26]} />
      <ambientLight intensity={theme === "light" ? 0.9 : 0.35} />
      <directionalLight position={[6, 8, 6]} intensity={theme === "light" ? 1.6 : 2.2} color={look.key} />
      <directionalLight position={[-6, 2, -4]} intensity={0.8} color={look.fill} />
      {/* A studio built from light panels, so reflections never come from the network (the CSP forbids it). */}
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={3} color="#ffffff" position={[0, 6, -2]} rotation-x={Math.PI / 2} scale={[14, 4, 1]} />
        <Lightformer form="rect" intensity={2} color="#ffffff" position={[-6, 1, 3]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} />
        <Lightformer form="rect" intensity={1.4} color={look.fill} position={[6, 0, 2]} rotation-y={-Math.PI / 2} scale={[8, 4, 1]} />
        <Lightformer form="ring" intensity={2.5} color="#ffffff" position={[3, 3, 6]} scale={2} />
        <Lightformer form="rect" intensity={1} color={look.dark} position={[0, -5, 0]} rotation-x={-Math.PI / 2} scale={[20, 20, 1]} />
      </Environment>
      <Candles mode={mode} progress={progress} count={count} still={still} theme={theme} />
      <Dust count={compact ? 220 : 520} still={still} theme={theme} />
      <Rig mode={mode} progress={progress} still={still} />
    </Canvas>
  );
}
