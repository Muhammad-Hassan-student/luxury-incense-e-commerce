"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, postJson, type StepResult } from "./client";

type Tone = "search" | "adjust" | "good";
type Probe = { faces: number; size: number; x: number; y: number };

const PROBE_MS = 280;
const MIN_SIZE = 0.24; // "Move a little closer" below this share of the frame width
const MAX_SIZE_FIRST = 0.62; // "Too close" for the first (resting) frame
const MAX_SIZE = 0.85;
const ZOOM_STEPS = [1, 1.1, 1.18];

const toneColour: Record<Tone, string> = { search: "#f4efe6", adjust: "#e3a64a", good: "#7cc48a" };

/**
 * Camera face check. A mirrored front-camera preview with an oval; a small 320px frame goes to /probe every ~280ms
 * for guidance (no recognition). Three 640px frames are taken automatically: when the face is well placed twice in
 * a row, then at ≥1.10× and ≥1.18× that size ("bring the phone a little closer"). Then they're submitted once.
 * Frames only live in memory and in that one request.
 */
export function FaceCapture({
  ticket,
  purpose,
  label,
  onDone,
  onError,
}: {
  ticket: string;
  purpose: "prove" | "add";
  label?: string;
  onDone: (r: StepResult) => void;
  /** Called with the server's error (its own wording). Return true if the caller handled it (e.g. expired ticket). */
  onError?: (e: ApiError) => boolean | void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [tone, setTone] = useState<Tone>("search");
  const [message, setMessage] = useState("Starting the camera…");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"camera" | "checking" | "failed" | "blocked">("camera");
  const [taken, setTaken] = useState(0);
  const [run, setRun] = useState(0);
  // Callbacks via refs so a parent re-render never restarts the camera.
  const doneRef = useRef(onDone);
  const errorRef = useRef(onError);
  useEffect(() => {
    doneRef.current = onDone;
    errorRef.current = onError;
  });

  const grab = useCallback((width: number, quality: number) => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.round((v.videoHeight / v.videoWidth) * width);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  }, []);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frames: string[] = [];
    let wellPlaced = 0;
    let baseSize = 0;

    const say = (t: Tone, m: string) => {
      setTone(t);
      setMessage(m);
    };

    async function submit() {
      setPhase("checking");
      say("good", "Checking…");
      stream?.getTracks().forEach((t) => t.stop());
      try {
        const res = await postJson<StepResult>("/api/security/face/verify", { ticket, purpose, frames, label });
        if (!stopped) doneRef.current(res);
      } catch (e) {
        if (stopped) return;
        const err = e instanceof ApiError ? e : new ApiError("Something went wrong. Please try again.", 0);
        if (errorRef.current?.(err)) return;
        setError(err.message);
        setPhase(err.status === 423 ? "blocked" : "failed");
      }
    }

    async function tick() {
      if (stopped) return;
      const small = grab(320, 0.7);
      if (!small) {
        timer = setTimeout(tick, PROBE_MS);
        return;
      }
      let p: Probe;
      try {
        p = await postJson<Probe>("/api/security/face/probe", { ticket, frame: small });
      } catch (e) {
        if (stopped) return;
        const err = e instanceof ApiError ? e : new ApiError("The camera check stopped. Please try again.", 0);
        if (err.status === 429) {
          timer = setTimeout(tick, 1500);
          return;
        }
        if (errorRef.current?.(err)) return;
        setError(err.message);
        setPhase("failed");
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      if (stopped) return;

      const stage = frames.length;
      const centred = Math.abs(p.x) <= 0.15 && Math.abs(p.y) <= 0.18;
      if (p.faces === 0) {
        wellPlaced = 0;
        say("search", "Look at the camera");
      } else if (p.faces > 1) {
        wellPlaced = 0;
        say("adjust", "Only you in the picture, please");
      } else if (stage === 0) {
        if (p.size < MIN_SIZE) say("adjust", "Move a little closer");
        else if (p.size > MAX_SIZE_FIRST) say("adjust", "Too close: move back");
        else if (!centred) say("adjust", "Keep your face in the middle");
        else {
          wellPlaced++;
          say("good", "Hold still");
          if (wellPlaced >= 2) {
            const full = grab(640, 0.85);
            if (full) {
              frames.push(full);
              baseSize = p.size;
              setTaken(1);
              say("good", "Now bring the phone a little closer");
            }
          }
        }
        if (!(p.size >= MIN_SIZE && p.size <= MAX_SIZE_FIRST && centred)) wellPlaced = 0;
      } else {
        const target = baseSize * ZOOM_STEPS[stage];
        if (p.size > MAX_SIZE) say("adjust", "Too close: move back");
        else if (!centred) say("adjust", "Keep your face in the middle");
        else if (p.size < target) say("adjust", "Now bring the phone a little closer");
        else {
          const full = grab(640, 0.85);
          if (full && full !== frames[frames.length - 1]) {
            frames.push(full);
            setTaken(frames.length);
            say("good", frames.length < 3 ? "A little closer still" : "Hold still");
          }
        }
      }
      if (frames.length >= ZOOM_STEPS.length) return void submit();
      timer = setTimeout(tick, PROBE_MS);
    }

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser can’t use the camera. Try the phone lock, or another browser.");
        setPhase("failed");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch {
        setError("We couldn’t open the camera. Allow camera access for this site, then try again.");
        setPhase("failed");
        return;
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      const v = videoRef.current;
      if (!v) return;
      v.srcObject = stream;
      await v.play().catch(() => {});
      say("search", "Look at the camera");
      timer = setTimeout(tick, 400);
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [ticket, purpose, label, grab, run]);

  const colour = toneColour[tone];
  return (
    <div className="space-y-5">
      <div className="relative mx-auto aspect-[3/4] w-full max-w-[22rem] overflow-hidden bg-bg-elev">
        <video ref={videoRef} playsInline muted className="size-full -scale-x-100 object-cover" aria-label="Camera preview" />
        <svg viewBox="0 0 300 400" className="pointer-events-none absolute inset-0 size-full" preserveAspectRatio="xMidYMid slice" aria-hidden>
          <defs>
            <mask id="face-oval">
              <rect width="300" height="400" fill="white" />
              <ellipse cx="150" cy="190" rx="98" ry="132" fill="black" />
            </mask>
          </defs>
          <rect width="300" height="400" fill="rgba(8,7,6,0.62)" mask="url(#face-oval)" />
          <ellipse cx="150" cy="190" rx="98" ry="132" fill="none" stroke={colour} strokeWidth={tone === "good" ? 3.5 : 2.5} style={{ transition: "stroke 300ms" }} />
        </svg>
        <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2 pb-4" aria-hidden>
          {ZOOM_STEPS.map((_, i) => (
            <span key={i} className="size-2 rounded-full border border-fg/60" style={{ background: i < taken ? colour : "transparent" }} />
          ))}
        </div>
      </div>
      {phase === "camera" || phase === "checking" ? (
        <p className="text-center font-display text-xl" style={{ color: colour }} role="status" aria-live="polite">
          {message}
        </p>
      ) : (
        <div className="space-y-4 text-center">
          <p className="border border-ember/40 p-4 text-sm text-ember" role="alert">
            {error}
          </p>
          {phase === "failed" && (
            <button
              type="button"
              className="link-draw text-[0.6875rem] uppercase tracking-[0.28em] text-fg"
              onClick={() => {
                setError(null);
                setTaken(0);
                setPhase("camera");
                setRun((n) => n + 1);
              }}
            >
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
