import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GithubIcon } from "@/claude-logo";
import { LegalDialog, type LegalDoc } from "@/legal";
import { cn } from "@/lib/utils";

// An 8-bit heart drawn pixel by pixel: X is a pixel, o is a lighter highlight.
const HEART = [".XX...XX.", "XoXX.XXXX", "XXXXXXXXX", "XXXXXXXXX", ".XXXXXXX.", "..XXXXX..", "...XXX...", "....X...."];

/** A small pixel-art heart that blinks. */
function PixelHeart({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 9 8" className={cn("animate-pulse", className)} shapeRendering="crispEdges" role="img" aria-label="love">
      {HEART.flatMap((row, y) => [...row].map((c, x) => (c === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" className={c === "o" ? "fill-rose-300" : "fill-rose-500"} />)))}
    </svg>
  );
}

export const REPO_URL = "https://github.com/ssanaullahrais/Chat-Vault";

/** "Made with love", the open source link and the app version. Shown at the bottom of the sidebar and of the overview. */
export function MadeWith({ className }: { className?: string }) {
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);
  return (
    <div className={cn("flex items-center justify-between gap-3 text-xs text-muted-foreground", className)}>
      <span className="flex items-center gap-1">
        Made with <PixelHeart className="h-3.5 w-4" />
      </span>
      <span className="flex items-center gap-2">
        <button className="flex cursor-pointer items-center gap-1 transition-colors hover:text-foreground" onClick={() => void openUrl(REPO_URL).catch(() => {})}>
          <GithubIcon className="size-3.5" /> Open source
        </button>
        {version && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none">v{version}</span>}
      </span>
    </div>
  );
}

/** The bottom of the overview, all in one row: the open source link, the version and the legal pages. */
export function OverviewFooter() {
  const [version, setVersion] = useState("");
  const [legal, setLegal] = useState<LegalDoc | null>(null);
  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);
  const link = "cursor-pointer underline-offset-4 transition-colors hover:text-foreground hover:underline";
  return (
    <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-xl border bg-card px-4 py-3 text-xs text-muted-foreground">
      <LegalDialog doc={legal} onDoc={setLegal} onClose={() => setLegal(null)} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button className="flex cursor-pointer items-center gap-1 transition-colors hover:text-foreground" onClick={() => void openUrl(REPO_URL).catch(() => {})}>
          <GithubIcon className="size-3.5" /> Open source
        </button>
        {version && <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none">v{version}</span>}
      </div>
      <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {([["privacy", "Privacy Policy"], ["terms", "Terms & Conditions"], ["disclaimer", "Disclaimer"]] as [LegalDoc, string][]).map(([id, label]) => (
          <button key={id} className={link} onClick={() => setLegal(id)}>
            {label}
          </button>
        ))}
      </nav>
    </footer>
  );
}
