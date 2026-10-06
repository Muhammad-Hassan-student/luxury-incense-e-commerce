import { useId } from "react";
import type { Model3D } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

/**
 * Lightweight procedural illustration for listings, bags and emails-in-browser.
 * The interactive WebGL model only loads on the product page.
 */
export function ProductArt({
  model,
  palette,
  className,
  animated = true,
}: {
  model: Model3D;
  palette: string[];
  className?: string;
  animated?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const [primary = "#2a2420", accent = "#c8a46a"] = palette;
  return (
    <svg viewBox="0 0 400 500" className={cn("h-full w-full", className)} role="img" aria-hidden>
      <defs>
        <radialGradient id={`${id}-glow`} cx="50%" cy="58%" r="55%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.32" />
          <stop offset="60%" stopColor={accent} stopOpacity="0.06" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-body`} x1="0" x2="1">
          <stop offset="0%" stopColor={primary} />
          <stop offset="45%" stopColor={mix(primary, "#ffffff", 0.18)} />
          <stop offset="100%" stopColor={mix(primary, "#000000", 0.35)} />
        </linearGradient>
        <linearGradient id={`${id}-gold`} x1="0" x2="1">
          <stop offset="0%" stopColor={mix(accent, "#000000", 0.3)} />
          <stop offset="50%" stopColor={mix(accent, "#ffffff", 0.35)} />
          <stop offset="100%" stopColor={mix(accent, "#000000", 0.25)} />
        </linearGradient>
        <radialGradient id={`${id}-flame`} cx="50%" cy="70%" r="60%">
          <stop offset="0%" stopColor="#fff6dc" />
          <stop offset="40%" stopColor="#ffb347" />
          <stop offset="100%" stopColor="#e2582b" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-blur`}>
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      <rect width="400" height="500" fill={`url(#${id}-glow)`} />
      <ellipse cx="200" cy="420" rx="120" ry="12" fill="#000" opacity="0.35" filter={`url(#${id}-blur)`} />

      {model === "INCENSE" && (
        <g>
          {[-14, 0, 12].map((rot, i) => (
            <g key={i} transform={`rotate(${rot} 200 400)`}>
              <rect x="198" y="150" width="4" height="250" fill={mix(accent, "#000", 0.45)} />
              <rect x="196" y="150" width="8" height="170" rx="4" fill={`url(#${id}-body)`} />
              <circle cx="200" cy="150" r="3" fill="#ff8a3d" className={animated ? "animate-flicker" : undefined} />
            </g>
          ))}
          <path d="M150 400 h100 l-12 18 h-76z" fill={`url(#${id}-gold)`} />
          <Smoke id={id} x={196} y={140} animated={animated} />
        </g>
      )}

      {model === "DHOOP" && (
        <g>
          <ellipse cx="200" cy="405" rx="105" ry="16" fill={`url(#${id}-gold)`} />
          {[150, 200, 250].map((x, i) => (
            <g key={x}>
              <path d={`M${x - 26} 398 L${x} ${330 - i * 6} L${x + 26} 398 Z`} fill={`url(#${id}-body)`} />
              {i === 1 && <circle cx={x} cy={322} r="4" fill="#ff8a3d" className={animated ? "animate-flicker" : undefined} />}
            </g>
          ))}
          <Smoke id={id} x={196} y={310} animated={animated} />
        </g>
      )}

      {model === "CANDLE" && (
        <g>
          <path d="M120 250 Q118 410 140 420 H260 Q282 410 280 250 Z" fill={`url(#${id}-body)`} />
          <ellipse cx="200" cy="250" rx="80" ry="14" fill={mix(primary, "#000", 0.4)} />
          <ellipse cx="200" cy="254" rx="70" ry="10" fill="#efe4cf" opacity="0.92" />
          <rect x="198" y="226" width="4" height="26" fill="#2a2420" />
          <ellipse cx="200" cy="210" rx="40" ry="60" fill="#ff8a3d" opacity="0.18" filter={`url(#${id}-blur)`} />
          <path
            d="M200 170 C214 196 212 218 200 228 C188 218 186 196 200 170 Z"
            fill={`url(#${id}-flame)`}
            className={animated ? "origin-[200px_228px] animate-[breathe_2.6s_ease-in-out_infinite]" : undefined}
          />
          <rect x="140" y="320" width="120" height="1" fill={accent} opacity="0.5" />
        </g>
      )}

      {model === "OIL" && (
        <g>
          <rect x="182" y="140" width="36" height="50" rx="3" fill={`url(#${id}-gold)`} />
          <rect x="190" y="188" width="20" height="18" fill={mix(accent, "#000", 0.3)} />
          <path d="M200 205 L270 300 L200 420 L130 300 Z" fill={`url(#${id}-body)`} opacity="0.92" />
          <path d="M200 205 L270 300 L200 300 Z" fill="#fff" opacity="0.08" />
          <path d="M200 300 L270 300 L200 420 Z" fill="#000" opacity="0.18" />
          <path d="M155 300 L200 360 L245 300" fill="none" stroke={accent} strokeWidth="1" opacity="0.6" />
        </g>
      )}

      {model === "BAKHOOR" && (
        <g>
          <path d="M140 290 Q200 330 260 290 L246 330 Q200 350 154 330 Z" fill={`url(#${id}-gold)`} />
          <rect x="186" y="330" width="28" height="50" fill={`url(#${id}-gold)`} />
          <path d="M150 380 h100 l10 30 h-120 z" fill={`url(#${id}-gold)`} />
          <ellipse cx="200" cy="292" rx="56" ry="10" fill="#2a1a12" />
          {[-24, -6, 12, 26].map((dx, i) => (
            <rect key={i} x={194 + dx} y={282 - (i % 2) * 4} width="14" height="8" rx="2" transform={`rotate(${dx} ${200 + dx} 288)`} fill={i % 2 ? "#ff8a3d" : primary} className={animated && i % 2 ? "animate-flicker" : undefined} />
          ))}
          <Smoke id={id} x={196} y={270} animated={animated} />
        </g>
      )}

      {model === "CARD" && (
        <g transform="rotate(-8 200 280)">
          <rect x="70" y="190" width="260" height="164" rx="10" fill={`url(#${id}-body)`} />
          <rect x="78" y="198" width="244" height="148" rx="7" fill="none" stroke={accent} strokeWidth="1" opacity="0.7" />
          <path d="M70 230 Q200 260 330 214 L330 240 Q200 288 70 256 Z" fill={`url(#${id}-gold)`} opacity="0.55" />
          <text x="98" y="236" fontFamily="var(--font-cormorant), serif" fontSize="15" letterSpacing="6" fill={accent}>
            MAISON OUD
          </text>
          <text x="98" y="330" fontFamily="var(--font-inter), sans-serif" fontSize="9" letterSpacing="4" fill={accent} opacity="0.8">
            GIFT CARD
          </text>
          <circle cx="292" cy="318" r="14" fill="none" stroke={accent} strokeWidth="1" />
          <path d="M292 326 V312 M292 312 C288 306 296 302 291 296" fill="none" stroke={accent} strokeWidth="1" />
        </g>
      )}

      {model === "GIFTBOX" && (
        <g>
          <rect x="110" y="260" width="180" height="150" fill={`url(#${id}-body)`} />
          <rect x="100" y="230" width="200" height="40" fill={mix(primary, "#fff", 0.08)} />
          <rect x="190" y="230" width="20" height="180" fill={`url(#${id}-gold)`} />
          <path d="M200 230 C160 190 140 220 170 230 M200 230 C240 190 260 220 230 230" fill="none" stroke={accent} strokeWidth="8" strokeLinecap="round" />
          <text x="200" y="350" textAnchor="middle" fontFamily="var(--font-cormorant), serif" fontSize="22" letterSpacing="6" fill={accent} opacity="0.85">
            MO
          </text>
        </g>
      )}
    </svg>
  );
}

function Smoke({ id, x, y, animated }: { id: string; x: number; y: number; animated: boolean }) {
  return (
    <g opacity="0.55" filter={`url(#${id}-blur)`}>
      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d={`M${x} ${y} C ${x - 30} ${y - 40}, ${x + 30} ${y - 70}, ${x - 6 + i * 6} ${y - 120} S ${x + 20} ${y - 170}, ${x - 10} ${y - 210}`}
          fill="none"
          stroke="#c9b79c"
          strokeWidth={10 - i * 3}
          strokeLinecap="round"
          opacity={0.5 - i * 0.12}
        >
          {animated && (
            <animate attributeName="stroke-dasharray" values="0 400;200 400;0 400" dur={`${6 + i * 2}s`} repeatCount="indefinite" />
          )}
        </path>
      ))}
    </g>
  );
}

/** Mixes two hex colours (t=0 → a, t=1 → b). */
function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}
