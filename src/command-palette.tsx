import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen } from "lucide-react";
import { sourceGlyph } from "@/source-icons";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from "@/components/ui/command";
import { ProviderLogo } from "@/claude-logo";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Highlight } from "@/highlight";
import { PROVIDERS, PROVIDER_SHORT, fmtDate, type Chat, type Provider } from "@/chat-actions";

type Hit = { id: string; snippet: string };

export type PaletteAction = { id: string; label: string; icon: ReactNode; shortcut?: string; run: () => void };

/** Ctrl+K: jump to any chat of either tool, or run an app action. */
export function CommandPalette({
  open,
  onOpenChange,
  provider,
  pinned,
  titleOf,
  onOpenChat,
  actions,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  provider: Provider;
  pinned: Chat[];
  titleOf: (c: Chat) => string;
  onOpenChat: (c: Chat, query?: string) => void;
  actions: PaletteAction[];
}) {
  const [value, setValue] = useState("");
  const [results, setResults] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(false);
  const [snippets, setSnippets] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) {
      setValue("");
      return;
    }
    let stale = false;
    setLoading(true);
    const q = value.trim();
    const t = window.setTimeout(async () => {
      try {
        // Same search as the sidebar: titles and projects, plus the words inside chats from the search index.
        const per = await Promise.all(
          PROVIDERS.map(async (p) => {
            const [titles, words] = await Promise.all([
              invoke<{ items: Chat[] }>("query_chats", { provider: p, account: "all", q, offset: 0, limit: q ? 30 : 8, sort: "recent", scope: "all" }).then((r) => r.items).catch(() => [] as Chat[]),
              q.length >= 2 ? invoke<Hit[]>("deep_search", { provider: p, query: q }).catch(() => [] as Hit[]) : Promise.resolve([] as Hit[]),
            ]);
            const inside = words.length ? await invoke<Chat[]>("chats_by_ids", { provider: p, ids: words.slice(0, 20).map((h) => h.id) }).catch(() => [] as Chat[]) : [];
            return { titles, inside, words };
          }),
        );
        if (stale) return;
        const found: Record<string, string> = {};
        const seen = new Set<string>();
        const list: Chat[] = [];
        per.forEach(({ titles, inside, words }) => {
          words.forEach((h) => (found[h.id] = h.snippet));
          [...titles, ...inside].forEach((c) => {
            const k = `${c.provider}:${c.id}`;
            if (!seen.has(k)) {
              seen.add(k);
              list.push(c);
            }
          });
        });
        list.sort((x, y) => y.lastMs - x.lastMs);
        setResults(list.slice(0, 12));
        setSnippets(found);
      } catch {
        if (!stale) setResults([]);
      } finally {
        if (!stale) setLoading(false);
      }
    }, 150);
    return () => {
      stale = true;
      window.clearTimeout(t);
    };
  }, [value, open]);

  const select = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };
  const q = value.trim().toLowerCase();
  const shownActions = actions.filter((a) => !q || a.label.toLowerCase().includes(q));
  const shownPinned = pinned.filter((c) => !q || titleOf(c).toLowerCase().includes(q));

  const item = (c: Chat) => (
    <CommandItem key={`${c.provider}:${c.id}`} value={`${c.provider}:${c.id}`} onSelect={() => select(() => onOpenChat(c, value.trim()))}>
      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-muted/80 border border-white/5">
        {sourceGlyph(c.provider, "size-4") ?? <ProviderLogo provider={c.provider} className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium text-foreground">{titleOf(c)}</span>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground/70 tabular-nums">{fmtDate(c.lastMs)}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
          {c.project && (
            <span className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground/80">
              <FolderOpen className="size-3 shrink-0 opacity-70" strokeWidth={1.5} />
              <span className="max-w-[140px] truncate">{c.project}</span>
            </span>
          )}
          {q && snippets[c.id] && (
            <span className="truncate text-xs text-muted-foreground/90 font-sans">
              <Highlight text={snippets[c.id]} q={value.trim()} activeMark={false} />
            </span>
          )}
        </div>
      </div>
    </CommandItem>
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search ChatVault" description="Find a chat or run an action.">
      <Command shouldFilter={false}>
        <CommandInput value={value} onValueChange={setValue} placeholder="Search chats, files, and actions…" />
        <ScrollArea className="h-[min(460px,60dvh)]">
        <CommandList className="max-h-none overflow-visible">
          {loading && results.length === 0 && (
            <div className="p-3 space-y-2" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 p-2 rounded-xl bg-white/5 border border-white/5">
                  <Skeleton className="size-7 shrink-0 rounded-lg" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!loading && results.length === 0 && shownActions.length === 0 && shownPinned.length === 0 && (
            <CommandEmpty className="py-12 text-center text-sm text-muted-foreground">No matches found for “{value}”.</CommandEmpty>
          )}
          {shownPinned.length > 0 && (
            <CommandGroup heading={`Pinned · ${PROVIDER_SHORT[provider]}`}>{shownPinned.map(item)}</CommandGroup>
          )}
          {results.length > 0 && (
            <>
              {shownPinned.length > 0 && <CommandSeparator />}
              <CommandGroup heading={q ? "Conversations" : "Recent conversations"}>{results.filter((c) => !shownPinned.some((p) => p.id === c.id && p.provider === c.provider)).slice(0, q ? 12 : 6).map(item)}</CommandGroup>
            </>
          )}
          {shownActions.length > 0 && (
            <>
              <CommandSeparator />
              <CommandGroup heading="Actions">
                {shownActions.map((a) => (
                  <CommandItem key={a.id} value={a.id} onSelect={() => select(a.run)}>
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-muted/80 border border-white/5">
                      {a.icon}
                    </div>
                    <span className="flex-1 font-medium">{a.label}</span>
                    {a.shortcut && <CommandShortcut>{a.shortcut}</CommandShortcut>}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
        </ScrollArea>
        <div className="flex items-center justify-between border-t border-white/10 px-4 py-2.5 bg-black/20 text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5"><kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] font-mono">↑</kbd> <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] font-mono">↓</kbd> navigate</span>
            <span className="flex items-center gap-1.5"><kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] font-mono">↵</kbd> open</span>
          </div>
          <span className="flex items-center gap-1.5"><kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[11px] font-mono">Esc</kbd> close</span>
        </div>
      </Command>
    </CommandDialog>
  );
}
