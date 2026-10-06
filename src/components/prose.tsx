import { Fragment, type ReactNode } from "react";

/**
 * Minimal Markdown for journal posts and content pages: ## / ### headings, - lists,
 * paragraphs, **bold**, *italic* and [links](/path). Text is rendered as React nodes, never raw HTML.
 */
export function Prose({ markdown }: { markdown: string }) {
  const blocks = markdown.trim().split(/\n{2,}/);
  return (
    <div className="space-y-6 text-lg leading-relaxed text-muted">
      {blocks.map((b, i) => {
        if (b.startsWith("### ")) return <h3 key={i} className="pt-6 font-display text-3xl text-fg">{inline(b.slice(4))}</h3>;
        if (b.startsWith("## ")) return <h2 key={i} className="pt-8 font-display text-4xl text-fg">{inline(b.slice(3))}</h2>;
        const lines = b.split("\n");
        if (lines.every((l) => l.startsWith("- "))) {
          return (
            <ul key={i} className="space-y-2 ps-5">
              {lines.map((l, j) => (
                <li key={j} className="list-disc marker:text-gold">{inline(l.slice(2))}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{inline(lines.join(" "))}</p>;
      })}
    </div>
  );
}

function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((p, i) => {
    if (p.startsWith("**")) return <strong key={i} className="font-medium text-fg">{p.slice(2, -2)}</strong>;
    if (p.startsWith("*") && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>;
    const link = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const safe = /^(\/|https?:|mailto:)/.test(link[2]) ? link[2] : "#";
      return <a key={i} href={safe} className="link-draw text-fg">{link[1]}</a>;
    }
    return <Fragment key={i}>{p}</Fragment>;
  });
}
