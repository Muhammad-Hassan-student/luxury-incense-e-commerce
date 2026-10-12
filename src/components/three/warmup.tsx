"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";

/**
 * Compiles every shader in the scene in the background before the first frame is drawn.
 *
 * Without this, the first render compiles programs synchronously and three.js waits on each one (its
 * shader-error check reads the link status). On Windows/ANGLE that stalled the page's main thread for ~10 s on
 * the home page — the site froze with nobody touching it. `compileAsync` uses KHR_parallel_shader_compile, so the
 * GPU process compiles while the page stays responsive; the canvas starts rendering (and fades in) once it's done.
 *
 * Mount it inside the Canvas *after* the scene content (so everything to compile exists), keep the Canvas on
 * `frameloop="never"` until `onReady` fires. It compiles invisible objects too (three traverses the whole scene).
 */
export function WarmUp({ onReady }: { onReady: () => void }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let alive = true;
    // A frame's grace so Suspense-loaded children have attached their meshes and materials to the scene.
    const id = requestAnimationFrame(() => {
      gl.compileAsync(scene, camera)
        .catch(() => {})
        .finally(() => alive && onReady());
    });
    return () => {
      alive = false;
      cancelAnimationFrame(id);
    };
  }, [gl, scene, camera, onReady]);
  return null;
}
