import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Clock, FolderOpen, Loader2, Search, SearchX, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { FadedScroll } from "@/faded-scroll";
import { sourceGlyph } from "@/source-icons";
import { ProviderLogo } from "@/claude-logo";
import { Highlight } from "@/highlight";
import { PROVIDERS, PROVIDER_NAME, PROVIDER_SHORT, fmtDate, type Chat, type Provider } from "@/chat-actions";
import { cn } from "@/lib/utils";

type Hit = { chat: Chat; snippet: string };
const none = (): Record<Provider, Hit[]> => ({ claude: [], codex: [], cursor: [], gemini: [], opencode: [], cline: [], grok: [], hermes: [], antigravity: [], imported: [] });

const RECENT_KEY = "chatvault.recentSearches";
const loadRecent = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
};

/** Search the words inside every chat of every tool. Results from each tool appear as soon as that tool has been searched. */
export function GlobalSearch({ onOpenChat, onClose, titleOf, initial = "" }: { onOpenChat: (c: Chat, query?: string) => void; onClose: () => void; titleOf: (c: Chat) => string; initial?: string }) {
  const [q, setQ] = useState(initial);
  const [hits, setHits] = useState<Record<Provider, Hit[]>>(none());
  const [busy, setBusy] = useState<Provider[]>([]);
  const [searched, setSearched] = useState("");
  const [only, setOnly] = useState<Provider | "all">("all");
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const run = useRef(0);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => input.current?.focus(), []);

  const remember = (term: string) => {
    const next = [term, ...recent.filter((r) => r.toLowerCase() !== term.toLowerCase())].slice(0, 8);
    setRecent(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* storage can be blocked */
    }
  };

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits(none());
      setBusy([]);
      setSearched("");
      return;
    }
    const id = ++run.current;
    const t = window.setTimeout(() => {
      setHits(none());
      setBusy([...PROVIDERS]);
      setSearched(term);
      PROVIDERS.forEach(async (p) => {
        try {
          const found = await invoke<{ id: string; snippet: string }[]>("deep_search", { provider: p, query: term });
          const chats = found.length ? await invoke<Chat[]>("chats_by_ids", { provider: p, ids: found.map((h) => h.id) }) : [];
          const by = new Map(chats.map((c) => [c.id, c]));
          const list = found.flatMap((h) => (by.has(h.id) ? [{ chat: by.get(h.id)!, snippet: h.snippet }] : []));
          if (run.current === id) setHits((s) => ({ ...s, [p]: list }));
        } catch {
          /* that tool could not be searched */
        } finally {
          if (run.current === id) setBusy((b) => b.filter((x) => x !== p));
        }
      });
    }, 350);
    return () => window.clearTimeout(t);
  }, [q]);

  const counts = useMemo(() => PROVIDERS.map((p) => [p, hits[p].length] as const), [hits]);
  const total = counts.reduce((n, [, c]) => n + c, 0);
  const typed = q.trim().length >= 2;
  const searching = busy.length > 0;
  const visible = PROVIDERS.filter((p) => (only === "all" || only === p) && (hits[p].length > 0 || busy.includes(p)));
  // Tools that were searched and found nothing stay out of the filter row, so it only offers choices that lead somewhere.
  const chips = counts.filter(([p, c]) => c > 0 || (busy.includes(p) && only === p));

  const open = (c: Chat) => {
    if (searched) remember(searched);
    onOpenChat(c, searched);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="border-b border-border/40 bg-surface-nav/60 px-8 py-6 backdrop-blur-md">
        <div className="mx-auto w-full max-w-4xl space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="font-heading text-2xl font-bold tracking-tight text-foreground">Deep Search</h2>
                <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 text-[11px] font-medium text-amber-400">
                  FTS5 Full-Text
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">Find any word, code snippet, or tool call inside all conversations.</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close search"
              className="flex size-9 cursor-pointer items-center justify-center rounded-full border border-border/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4.5" />
            </button>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4.5 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
            <input
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && (q ? setQ("") : onClose())}
              placeholder="Search any keyword, error, or prompt across all tools..."
              className="h-12 w-full rounded-xl border border-white/10 bg-[#161618] pl-11 pr-11 text-base text-foreground placeholder:text-muted-foreground/60 outline-none transition-all focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30"
            />
            <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
              {searching ? (
                <Loader2 className="size-4.5 animate-spin text-amber-400" />
              ) : q ? (
                <button
                  type="button"
                  aria-label="Clear"
                  className="flex size-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => setQ("")}
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-7 flex-wrap items-center gap-1.5">
            {typed && chips.length > 0 ? (
              <>
                <FilterChip active={only === "all"} onClick={() => setOnly("all")}>
                  All <span className="tabular-nums opacity-70">{total}</span>
                </FilterChip>
                {chips.map(([p, c]) => (
                  <FilterChip key={p} active={only === p} onClick={() => setOnly(p)}>
                    {sourceGlyph(p, "size-3.5") ?? <ProviderLogo provider={p} className="size-3.5" />}
                    {PROVIDER_SHORT[p]} <span className="tabular-nums opacity-70">{c}</span>
                  </FilterChip>
                ))}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {!typed ? "Type at least 2 letters." : searching ? `Searching ${busy.map((p) => PROVIDER_SHORT[p]).join(", ")}…` : "No matches found."}
              </p>
            )}
            {typed && chips.length > 0 && (
              <span className="ml-auto font-mono text-xs text-muted-foreground">
                {searching ? `Searching ${busy.length} more…` : `${total.toLocaleString()} ${total === 1 ? "chat" : "chats"} found`}
              </span>
            )}
          </div>
        </div>
      </div>

      <FadedScroll className="flex-1">
        <div className="mx-auto w-full max-w-4xl space-y-6 px-8 pb-12 pt-6">
          {!typed && (
            <div className="space-y-6 pt-2">
              {recent.length > 0 && (
                <section>
                  <div className="mb-2.5 flex items-center justify-between">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <Clock className="size-3.5" /> Recent searches
                    </h3>
                    <button
                      type="button"
                      className="cursor-pointer text-xs text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() => {
                        setRecent([]);
                        try {
                          localStorage.removeItem(RECENT_KEY);
                        } catch {
                          /* storage can be blocked */
                        }
                      }}
                    >
                      Clear
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recent.map((r) => (
                      <button
                        key={r}
                        type="button"
                        className="cursor-pointer rounded-full border border-white/10 bg-[#18181b] px-3.5 py-1 text-xs text-muted-foreground transition-all hover:border-amber-500/30 hover:bg-[#202024] hover:text-amber-300"
                        onClick={() => setQ(r)}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              <div className="flex flex-col items-center gap-3.5 rounded-2xl border border-white/10 bg-[#161618]/60 px-6 py-12 text-center">
                <div className="flex -space-x-1.5">
                  {PROVIDERS.map((p) => (
                    <span key={p} title={PROVIDER_NAME[p]} className="flex size-8 items-center justify-center rounded-full bg-surface-muted p-1.5 ring-2 ring-background border border-white/5">
                      {sourceGlyph(p, "size-full") ?? <ProviderLogo provider={p} className="size-full" />}
                    </span>
                  ))}
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">Search inside every conversation</p>
                  <p className="mt-1 max-w-md text-xs text-muted-foreground leading-relaxed">
                    Full-text index searches user prompts, agent reasoning, assistant responses, and tool calls simultaneously.
                  </p>
                </div>
              </div>
            </div>
          )}

          {typed && searching && total === 0 && (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2.5 rounded-xl border border-white/10 bg-[#161618] p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Skeleton className="size-7 rounded-lg" />
                      <Skeleton className="h-4 w-48" />
                    </div>
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-12 w-full rounded-lg" />
                </div>
              ))}
            </div>
          )}

          {typed && visible.map((p) => (
            <section key={p}>
              <div className="mb-3 mt-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <div className="flex size-5 items-center justify-center rounded-md bg-surface-muted border border-white/5">
                  {sourceGlyph(p, "size-3.5") ?? <ProviderLogo provider={p} className="size-3.5" />}
                </div>
                <span>{PROVIDER_NAME[p]}</span>
                {busy.includes(p) ? (
                  <Loader2 className="size-3 animate-spin text-amber-400" />
                ) : (
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[11px] text-muted-foreground tabular-nums">
                    {hits[p].length}
                  </span>
                )}
              </div>
              <div className="space-y-2.5">
                {hits[p].map((h) => (
                  <button
                    key={h.chat.id}
                    onClick={() => open(h.chat)}
                    className="group flex w-full cursor-pointer flex-col gap-2 rounded-xl border border-white/10 bg-[#161618] p-4 text-left transition-all hover:border-amber-500/30 hover:bg-[#1c1c1f] hover:shadow-lg"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-muted/80 border border-white/5">
                          {sourceGlyph(h.chat.provider, "size-4") ?? <ProviderLogo provider={h.chat.provider} className="size-4" />}
                        </div>
                        <span className="truncate text-sm font-medium text-foreground group-hover:text-amber-300 transition-colors">
                          {titleOf(h.chat)}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        {h.chat.project && (
                          <span className="flex items-center gap-1 rounded-md bg-white/5 px-2 py-0.5 text-[11px] font-mono border border-white/5">
                            <FolderOpen className="size-3 shrink-0 opacity-70" strokeWidth={1.5} />
                            <span className="max-w-[150px] truncate">{h.chat.project}</span>
                          </span>
                        )}
                        <span className="tabular-nums font-mono text-[11px] opacity-70">{fmtDate(h.chat.lastMs)}</span>
                      </div>
                    </div>
                    <div className="mt-1 rounded-lg border border-white/5 bg-black/25 px-3 py-2 text-[13px] leading-relaxed text-muted-foreground font-sans">
                      <Highlight text={h.snippet} q={searched} activeMark={false} />
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}

          {typed && !searching && total === 0 && (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl border border-white/10 bg-[#161618]">
                <SearchX className="size-6 text-muted-foreground" strokeWidth={1.5} />
              </span>
              <div>
                <p className="text-base font-medium text-foreground">No conversation contains “{searched}”</p>
                <p className="mt-1 max-w-sm text-xs text-muted-foreground">Try a different term, check the spelling, or choose another provider.</p>
              </div>
            </div>
          )}
        </div>
      </FadedScroll>
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all",
        active
          ? "border-amber-500/30 bg-amber-500/15 text-amber-300 shadow-xs"
          : "border-white/5 bg-[#18181b] text-muted-foreground hover:border-white/15 hover:bg-[#202024] hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
