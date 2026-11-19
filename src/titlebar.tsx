import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Moon, PanelLeft, RefreshCw, Search, Settings as SettingsIcon, Square, Sun, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { VaultLogo } from "@/claude-logo";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function Control({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn("mx-0.5 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground", danger ? "hover:bg-red-600 hover:text-white" : "hover:bg-muted")}
    >
      {children}
    </button>
  );
}

/**
 * The global top bar of the reference mockup: brand on the left, a centered search field
 * that filters the conversation list while typing, and controls on the right.
 */
export function TitleBar({
  sidebarOpen,
  busy,
  dark,
  query,
  onQuery,
  onToggleSidebar,
  onRefresh,
  onTheme,
  onHome,
  onSearch,
  onOpenPalette,
  onSettings,
}: {
  sidebarOpen: boolean;
  busy: boolean;
  dark: boolean;
  query: string;
  onQuery: (q: string) => void;
  onToggleSidebar: () => void;
  onRefresh: () => void;
  onTheme: () => void;
  onHome: () => void;
  onSearch: (q: string) => void;
  onOpenPalette?: () => void;
  onSettings: () => void;
}) {
  const [max, setMax] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!inTauri) return;
    const w = getCurrentWindow();
    const sync = () => void w.isMaximized().then(setMax).catch(() => {});
    sync();
    let off: (() => void) | undefined;
    void w.onResized(sync).then((u) => (off = u));
    return () => off?.();
  }, []);

  const w = inTauri ? getCurrentWindow() : null;

  return (
    <header
      data-tauri-drag-region
      className="relative z-30 flex h-[70px] shrink-0 select-none items-center border-b border-border bg-topbar pl-2 pr-4 text-xs text-muted-foreground"
    >
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label={sidebarOpen ? "Hide the sidebar" : "Show the sidebar"}
          onClick={onToggleSidebar}
          className="flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <PanelLeft className="size-4" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={onHome}
          className="flex cursor-pointer items-center gap-2.5 rounded-md py-1 pl-1.5 pr-3 text-left transition-colors hover:bg-muted/60"
          title="Back to Home"
        >
          <VaultLogo className="size-8 shrink-0" />
          <span className="font-heading text-[22px] leading-none text-foreground">ChatVault</span>
        </button>
      </div>

      {/* Centered search: typing filters the list, Enter runs the full search page. */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 w-[568px] max-w-[42vw] -translate-x-1/2 -translate-y-1/2">
        <div className="pointer-events-auto flex h-12 items-center gap-2.5 rounded-xl border border-[#3d3f41] bg-topbar-field pl-4 pr-2.5 shadow-none transition-colors focus-within:border-muted-foreground/60">
          <Search className="size-4.5 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <input
            ref={inputRef}
            data-tauri-drag-region={false}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSearch(query);
              } else if (e.key === "Escape") {
                e.currentTarget.blur();
              }
            }}
            placeholder="Search conversations, files, tools..."
            aria-label="Search conversations"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={() => (onOpenPalette ? onOpenPalette() : onSearch(query))}
            title="Search all conversations (Ctrl+K)"
            className="flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Ctrl K
          </button>
        </div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <Control label="Scan this PC for new chats" onClick={onRefresh}>
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} strokeWidth={1.5} />
        </Control>
        <Control label={dark ? "Light theme" : "Dark theme"} onClick={onTheme}>
          {dark ? <Sun className="size-3.5" strokeWidth={1.5} /> : <Moon className="size-3.5" strokeWidth={1.5} />}
        </Control>
        <button
          type="button"
          aria-label="Settings"
          onClick={onSettings}
          className="mx-1.5 flex size-11 cursor-pointer items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-muted"
          title="Settings"
        >
          <SettingsIcon className="size-5" strokeWidth={1.75} />
        </button>
        {w && (
          <>
            <span className="mx-1.5 h-4 w-px shrink-0 bg-border" />
            <Control label="Minimize" onClick={() => void w.minimize()}>
              <Minus className="size-4" strokeWidth={1.5} />
            </Control>
            <Control label={max ? "Restore" : "Maximize"} onClick={() => void w.toggleMaximize()}>
              {max ? <Copy className="size-3.5" strokeWidth={1.5} /> : <Square className="size-3.5" strokeWidth={1.5} />}
            </Control>
            <Control label="Close" danger onClick={() => void w.close()}>
              <X className="size-4" strokeWidth={1.5} />
            </Control>
          </>
        )}
      </div>
    </header>
  );
}
