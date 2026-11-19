import type { ReactNode } from "react";
import claude from "@fortawesome/fontawesome-free/svgs/brands/claude.svg?raw";
import openai from "@fortawesome/fontawesome-free/svgs/brands/openai.svg?raw";
import cube from "@fortawesome/fontawesome-free/svgs/solid/cube.svg?raw";
import code from "@fortawesome/fontawesome-free/svgs/solid/code.svg?raw";
import feather from "@fortawesome/fontawesome-free/svgs/solid/feather.svg?raw";
import download from "@fortawesome/fontawesome-free/svgs/solid/download.svg?raw";

const triangleOutline = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 4 21 20 3 20" /></svg>`;
const geminiSparkle = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1C12 7.075 7.075 12 1 12c6.075 0 12 4.925 12 11 0-6.075 4.925-11 11-11-6.075 0-11-4.925-11-11z"/></svg>`;
const grokSvg = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="m24 .389-3.3 3.33v-.01L9.27 15.295l7.978-5.943c.391-.292.95-.178 1.137.275.98 2.387.541 5.255-1.41 7.225s-4.667 2.401-7.149 1.418l-2.71 1.267c3.888 2.683 8.61 2.02 11.562-.96 2.34-2.363 3.064-5.583 2.386-8.487l.008.006c-.983-4.266.241-5.97 2.75-9.457zM11.922 3.115A8.93 8.93 0 0 0 5.984 5.76c-2.533 2.556-3.33 6.487-1.963 9.842 1.022 2.507-.652 4.28-2.34 6.07-.597.634-1.198 1.268-1.681 1.94l7.621-6.87.002-.002c-2.791-2.69-2.311-6.856.07-9.258C9.455 5.705 12.34 4.98 14.86 6.047l2.705-1.262a7.8 7.8 0 0 0-1.828-1.006 8.9 8.9 0 0 0-3.814-.664"/></svg>`;

/** Font Awesome glyphs for the SOURCES rows, matching the shapes and colors of the mockup. */
const glyphs: Record<string, { svg: string; className?: string }> = {
  claude: { svg: claude, className: "text-[#e07a38]" },
  codex: { svg: openai, className: "text-muted-foreground" },
  cursor: { svg: cube, className: "text-muted-foreground" },
  opencode: { svg: code, className: "text-[#f0a83c]" },
  hermes: { svg: feather, className: "text-muted-foreground" },
  antigravity: { svg: triangleOutline, className: "text-muted-foreground" },
  imported: { svg: download, className: "text-muted-foreground" },
  chatgpt: { svg: openai, className: "text-muted-foreground" },
  gemini: { svg: geminiSparkle, className: "text-muted-foreground" },
  grok: { svg: grokSvg, className: "text-muted-foreground" },
};

/** The glyph for a source, or null when the provider keeps its own logo. */
export function sourceGlyph(provider: string, className = "size-4"): ReactNode | null {
  const glyph = glyphs[provider.toLowerCase()];
  if (!glyph) return null;
  const hasTextColor = /\btext-/.test(className);
  const colorClass = hasTextColor ? "" : (glyph.className ?? "");
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center [&>svg]:size-full ${className} ${colorClass}`.trim()}
      dangerouslySetInnerHTML={{ __html: glyph.svg }}
    />
  );
}
