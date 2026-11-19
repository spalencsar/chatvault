import { FileViewContext, FileViewer, isFilePath } from "@/file-viewer";
import { StickyOpenContext, useStickyOpen } from "@/sticky-open";
import { ChatImage, GalleryContext, Lightbox } from "@/image-viewer";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useLayoutEffect, useMemo, memo, useRef, useState, type ReactElement } from "react";
import {
  ExternalLink,
  Save,
  LayoutDashboard,
  RefreshCw,
  ArrowRightLeft,
  ArrowUp,
  FolderOpen,
  Archive,
  ArchiveRestore,
  ArrowDown,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  GitBranch,
  MessageSquareText,
  Copy,
  FileText,
  ListTree,
  Loader2,
  Play,
  Pencil,
  Pin,
  PinOff,
  Search,
  Trash2,
  User,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { openUrl } from "@tauri-apps/plugin-opener";
import { copyImage, downloadImage } from "@/image-viewer";
import { ContextArea, type Entry } from "@/context-area";
import { ActionIcon } from "@/action-icon";
import { runAction } from "@/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ProviderLogo, visualProvider } from "@/claude-logo";
import { sourceGlyph } from "@/source-icons";
import { MessageBody } from "@/message-body";
import { Highlight, textHas } from "@/highlight";
import {
  PROVIDER_SHORT,
  chatActions,
  continueTargets,
  COPY_CONTENT_IDS,
  deleteKind,
  prettyTitle,
  prepareHandoff,
  buildPrompt,
  type Chat,
  type ChatAction,
  type Msg,
  type MsgPage,
  type Provider,
} from "@/chat-actions";
import { HeaderSkeleton, MessagesSkeleton } from "@/skeletons";
import { PlanBlock, StepItem, SubagentBlock, isAgent, isPlan, mergeResults, stepName, type Item } from "@/steps";

type Props = {
  chat: Chat;
  page: MsgPage | null;
  loadingEarlier: boolean;
  live?: boolean;
  outline?: { ts: string; text: string }[] | null;
  onLoadUntil?: (ts: string) => Promise<void>;
  onLoadEarlier: () => void;
  onLoadAll: () => Promise<void>;
  showSteps: boolean;
  onToggleSteps: () => void;
  headerOpen: boolean;
  onToggleHeader: () => void;
  pinned: boolean;
  onTogglePin: () => void;
  onArchive?: () => void;
  onRename: () => void;
  onDelete: () => void;
  onRefresh?: () => void;
  onOverview?: () => void;
  /** Open the all-chats search with this word already typed. */
  onSearchAll?: (q: string) => void;
  initialQuery?: string;
  toast: (m: string) => void;
};

function Tip({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent className="max-w-xs">{label}</TooltipContent>
    </Tooltip>
  );
}

type Block = { kind: "msg"; i: number; m: Item } | { kind: "plan"; i: number; m: Item } | { kind: "agent"; i: number; m: Item } | { kind: "trace"; i: number; items: { i: number; m: Item }[] };

export function ChatView(p: Props) {
  const { chat, page } = p;
  const logoProvider = visualProvider(chat.provider, chat.account);
  const [searchOpen, setSearchOpen] = useState(() => Boolean(p.initialQuery));
  const [q, setQ] = useState(() => p.initialQuery || "");
  const [cur, setCur] = useState(0);
  const [showJump, setShowJump] = useState(false);
  const [atTop, setAtTop] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const [fileOpen, setFileOpen] = useState<string | null>(null);
  const [composerText, setComposerText] = useState("");
  const [handoffBusy, setHandoffBusy] = useState(false);

  const handleHandoff = async () => {
    if (handoffBusy) return;
    setHandoffBusy(true);
    try {
      const handoffPath = await prepareHandoff(chat);
      let prompt = buildPrompt(chat, handoffPath);
      if (composerText.trim()) {
        prompt += `\n\nAdditional user instructions:\n${composerText.trim()}`;
      }
      await navigator.clipboard.writeText(prompt);
      p.toast("Handoff prompt copied to clipboard");
      setComposerText("");
    } catch (e) {
      p.toast(`Handoff failed: ${e}`);
    } finally {
      setHandoffBusy(false);
    }
  };
  // Full paths the chat itself mentions. A short path like src/app.tsx is looked up under the folders they point into,
  // so it still opens when the chat worked on a project other than its own folder.
  const fileHints = useMemo(() => {
    if (!fileOpen || !page) return [];
    const seen = new Set<string>();
    for (const m of page.messages) {
      const data = typeof m.data === "string" ? m.data : m.data ? JSON.stringify(m.data) : "";
      // JSON doubles every backslash in a path; undo that before looking for drive paths.
      const text = `${m.text}\n${data}`.split("\\\\").join("\\");
      for (const hit of text.match(/[A-Za-z]:\\[^\s"'`<>|*?]+/g) ?? []) {
        seen.add(hit.replace(/[.,;:)\]]+$/, ""));
        if (seen.size >= 300) return [...seen];
      }
    }
    return [...seen];
  }, [fileOpen, page]);
  const fileCtx = useMemo(() => ({ base: chat.cwd ?? null, open: (path: string) => setFileOpen(path) }), [chat.cwd]);
  useEffect(() => setFileOpen(null), [chat.id]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [margin, setMargin] = useState(0);

  const merged = useMemo(() => (page ? mergeResults(page.messages) : []), [page]);
  const shown = useMemo(() => merged.filter((m) => p.showSteps || (m.kind !== "tool" && m.kind !== "reasoning")), [merged, p.showSteps]);
  const viewport = useCallback(() => wrapRef.current?.querySelector<HTMLElement>("[data-slot=scroll-area-viewport]") ?? null, []);

  const ready = page !== null;
  const userTick = useRef(0);
  const firstRequested = useRef(false);
  const pending = useRef<string | null>(null);

  // Consecutive tool steps collapse into one Trace.
  const blocks = useMemo(() => {
    const out: Block[] = [];
    shown.forEach((m, i) => {
      if (isPlan(m)) out.push({ kind: "plan", i, m });
      else if (isAgent(m)) out.push({ kind: "agent", i, m });
      else if (m.kind === "tool" || m.kind === "reasoning") {
        const last = out[out.length - 1];
        if (last && last.kind === "trace") last.items.push({ i, m });
        else out.push({ kind: "trace", i, items: [{ i, m }] });
      } else out.push({ kind: "msg", i, m });
    });
    return out;
  }, [shown]);

  // Stable keys keep measured heights when earlier messages are added above.
  const keys = useMemo(() => {
    const seen = new Map<string, number>();
    const list = blocks.map((b) => {
      const m = b.kind === "trace" ? b.items[0].m : b.m;
      const base = `${b.kind}|${m.ts ?? ""}|${m.role}|${m.text.slice(0, 48)}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return `${base}|${n}`;
    });
    return list;
  }, [blocks]);
  const blockOf = useMemo(() => {
    const out: number[] = [];
    blocks.forEach((b, bi) => {
      if (b.kind === "trace") b.items.forEach((t) => (out[t.i] = bi));
      else out[b.i] = bi;
    });
    return out;
  }, [blocks]);

  // A first guess for the height of a row from its text, so rows measured later move the page as little as possible.
  const estimate = (i: number) => {
    const b = blocks[i];
    if (!b) return 90;
    if (b.kind === "trace") return 36;
    if (b.kind !== "msg") return 90;
    const t = b.m.text;
    let lines = 0;
    for (let at = 0; at < t.length; ) {
      const nl = t.indexOf("\n", at);
      const end = nl < 0 ? t.length : nl;
      lines += Math.max(1, Math.ceil((end - at) / 80));
      if (nl < 0) break;
      at = nl + 1;
      if (lines > 60) break;
    }
    return Math.min(1100, 52 + Math.min(lines, 60) * 24);
  };

  const openMemo = useMemo(() => new Map<string, boolean>(), [chat.id]);

  const virt = useVirtualizer({
    count: blocks.length,
    getScrollElement: viewport,
    estimateSize: estimate,
    overscan: 8,
    scrollMargin: margin,
    getItemKey: (i) => keys[i] ?? i,
    // Messages added above keep the row at the top of the screen where it is, in the same render, not a frame later.
    anchorTo: "end",
    followOnAppend: true,
    scrollEndThreshold: 80,
    scrollPaddingStart: 16,
  });
  // The browser owns wheel/touch movement; the virtualizer owns anchoring and navigation.
  // Cancel its pending navigation as soon as the reader takes over.
  useEffect(() => {
    const el = viewport();
    if (!el) return;
    const cancel = () => {
      userTick.current++;
      firstRequested.current = false;
      pending.current = null;
      virt.cancelScroll();
    };
    const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    events.forEach((event) => el.addEventListener(event, cancel, { passive: true }));
    return () => events.forEach((event) => el.removeEventListener(event, cancel));
  }, [viewport, virt]);

  useLayoutEffect(() => {
    if (ready) virt.scrollToEnd();
  }, [ready, chat.id, virt]);

  // Loading indicators above the list can change without page.start changing.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const update = () => setMargin(list.offsetTop);
    update();
    const observer = new ResizeObserver(update);
    if (list.parentElement) observer.observe(list.parentElement);
    return () => observer.disconnect();
  }, [ready, page?.start, page?.partial]);

  useLayoutEffect(() => {
    if (firstRequested.current && page?.start === 0 && !page.partial) {
      firstRequested.current = false;
      virt.scrollToOffset(0);
    }
  }, [page, virt]);

  const goTo = useCallback(
    (shownIdx: number, align: "start" | "center", instant = false) => {
      const bi = blockOf[shownIdx];
      const el = viewport();
      if (bi === undefined || !el) return;
      const target = virt.getOffsetForIndex(bi, align)?.[0] ?? el.scrollTop;
      // Distant navigation should not animate through thousands of unmeasured messages.
      const distant = Math.abs(target - el.scrollTop) > el.clientHeight * 2.5;
      virt.scrollToIndex(bi, { align, behavior: instant || distant ? "auto" : "smooth" });
    },
    [blockOf, viewport, virt],
  );

  const images = useMemo(() => shown.filter((m) => m.kind === "image" && typeof m.data === "string").map((m) => m.data as string), [shown]);
  const gallery = useMemo(() => ({ images, open: (src: string) => setViewer(Math.max(0, images.indexOf(src))) }), [images]);
  useEffect(() => setViewer(null), [chat.id]);

  const query = searchOpen ? q.trim() : "";
  const matches = useMemo(() => {
    if (!query) return [] as number[];
    const out: number[] = [];
    shown.forEach((m, i) => {
      if (m.kind !== "image" && textHas(m.text, query)) out.push(i);
    });
    return out;
  }, [shown, query]);
  const matchIndex = matches.length ? Math.min(cur, matches.length - 1) : -1;
  const lastSearchJump = useRef<string | null>(null);
  useEffect(() => setCur(0), [query, chat.id]);
  useEffect(() => {
    if (matchIndex < 0) {
      lastSearchJump.current = null;
      return;
    }
    const target = `${query}|${matchIndex}|${keys[blockOf[matches[matchIndex]]]}`;
    if (lastSearchJump.current === target) return;
    lastSearchJump.current = target;
    goTo(matches[matchIndex], "center");
  }, [query, matchIndex, matches, keys, blockOf, goTo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
        window.setTimeout(() => searchRef.current?.select(), 0);
      }
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (p.initialQuery) {
      setSearchOpen(true);
      setQ(p.initialQuery);
      setCur(0);
    } else {
      setSearchOpen(false);
      setQ("");
    }
  }, [chat.id, p.initialQuery]);

  const live = useRef({ start: 0, loading: false, partial: false, loadEarlier: p.onLoadEarlier });
  live.current = { start: page?.start ?? 0, loading: p.loadingEarlier, partial: !!page?.partial, loadEarlier: p.onLoadEarlier };
  const ticks = useMemo(() => shown.map((m, i) => ({ m, i })).filter((t) => t.m.role === "user" && t.m.kind === "text"), [shown]);
  useEffect(() => {
    const el = viewport();
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      // Near the top of what is loaded, the next earlier messages are read; the view stays where it is.
      if (live.current.start > 0 && !live.current.loading && !live.current.partial && el.scrollTop - margin < 1800) live.current.loadEarlier();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > 400);
        setAtTop(el.scrollTop < 8);
        setAtEnd(el.scrollHeight - el.scrollTop - el.clientHeight < 8);
      });
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [viewport, page, virt, margin]);


  const loadAll = async () => {
    setLoadingAll(true);
    try {
      await p.onLoadAll();
    } finally {
      setLoadingAll(false);
    }
  };

  const needsAll = searchOpen && !!query && !!page && page.start > 0;
  useEffect(() => {
    if (needsAll && !loadingAll) void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsAll]);

  // The timeline covers the whole chat: ticks come from the light outline, and the ones already loaded jump straight there.
  const barTicks = useMemo(() => {
    const keyOf = (ts: string, text: string) => `${ts}|${text.trim().slice(0, 60)}`;
    const loaded = new Map<string, number>();
    ticks.forEach((t, k) => loaded.set(keyOf(t.m.ts ?? "", t.m.text), k));
    const out: { key: string; i: number; text: string; ts?: string; loaded: boolean; k: number }[] = [];
    const used = new Set<string>();
    (p.outline ?? []).forEach((o) => {
      const key = keyOf(o.ts, o.text);
      const k = loaded.get(key);
      used.add(key);
      out.push({ key, i: k !== undefined ? ticks[k].i : -1, text: o.text, ts: o.ts, loaded: k !== undefined, k: k ?? -1 });
    });
    ticks.forEach((t, k) => {
      const key = keyOf(t.m.ts ?? "", t.m.text);
      if (!used.has(key)) out.push({ key, i: t.i, text: t.m.text, ts: t.m.ts, loaded: true, k });
    });
    return out;
  }, [ticks, p.outline]);
  /** The first message of the chat: reads every earlier message first when only the latest are loaded. */
  const goToFirst = async () => {
    firstRequested.current = true;
    const tick = userTick.current;
    if ((page?.start ?? 0) > 0) {
      try {
        if (p.onLoadUntil) await p.onLoadUntil("1970-01-01T00:00:00Z");
        else await p.onLoadAll();
      } catch {
        firstRequested.current = false;
      }
    } else if (userTick.current === tick) {
      firstRequested.current = false;
      virt.scrollToOffset(0);
    }
  };
  useEffect(() => {
    const key = pending.current;
    if (!key) return;
    const hit = barTicks.find((t) => t.key === key && t.loaded);
    if (hit) {
      pending.current = null;
      goTo(hit.i, "start", true);
    }
  }, [barTicks, goTo]);

  /**
   * Right-click menu of the chat window. The first block depends on what was clicked (selected words, a link, a picture, a file
   * name, a message); below it come the things people do with a chat: pick it up again, move it, copy it, save it.
   */
  const menuEntries = (target: HTMLElement): Entry[] => {
    // Windows opened above the chat (picture viewer, file viewer) have their own controls.
    if (target.closest('[role="dialog"], [data-lightbox], [data-slot="dialog-content"]')) return [];
    const out: Entry[] = [];
    const say = (text: string, what: string) => async () => {
      await navigator.clipboard.writeText(text);
      p.toast(`${what} copied`);
    };
    const selection = window.getSelection()?.toString().trim() ?? "";
    const link = target.closest("a")?.getAttribute("href");
    const img = target.closest("img");
    const at = target.closest<HTMLElement>("[data-index]");
    const block = at ? blocks[Number(at.dataset.index)] : undefined;
    const said = block && block.kind === "msg" ? (block as { m?: Msg }).m : undefined;
    const codeText = target.closest("code")?.textContent?.trim() ?? "";
    const word = selection && selection.length <= 80 && !selection.includes("\n") ? selection : "";

    // What was clicked
    if (img?.src) {
      out.push(
        { type: "item", label: "Copy image", icon: <Copy strokeWidth={1.5} />, onSelect: () => copyImage(img.src) },
        { type: "item", label: "Save image", icon: <Save strokeWidth={1.5} />, onSelect: () => downloadImage(img.src, 1) },
      );
    }
    if (link) {
      out.push(
        { type: "item", label: "Open link in the browser", icon: <ExternalLink strokeWidth={1.5} />, onSelect: () => void openUrl(link).catch(() => {}) },
        { type: "item", label: "Copy link address", icon: <Copy strokeWidth={1.5} />, onSelect: say(link, "Link") },
      );
    }
    const path = word || codeText;
    if (path && isFilePath(path)) out.push({ type: "item", label: "Open this file", icon: <FileText strokeWidth={1.5} />, onSelect: () => setFileOpen(path) });
    if (selection) out.push({ type: "item", label: "Copy selection", icon: <Copy strokeWidth={1.5} />, onSelect: say(selection, "Selection") });
    if (word && p.onSearchAll) out.push({ type: "item", label: `Search all chats for “${word.length > 24 ? `${word.slice(0, 24)}…` : word}”`, icon: <Search strokeWidth={1.5} />, onSelect: () => p.onSearchAll?.(word) });
    if (said?.text && !selection) out.push({ type: "item", label: said.role === "user" ? "Copy your message" : "Copy this reply", icon: <Copy strokeWidth={1.5} />, onSelect: say(said.text, "Message") });
    if (out.length) out.push({ type: "sep" });

    // The same order as the "…" menu on a sidebar card.
    const acts = chatActions(chat, p.toast, page?.messages ?? null);
    const asEntry = (a: ChatAction, label?: string): Entry => {
      return { type: "item", label: label ?? a.label, icon: <ActionIcon action={a} className="size-4" />, onSelect: () => runAction(a.label, a.run) };
    };
    const short = (a: ChatAction) => a.label.replace(/^Continue in /, "").replace(/^Copy /, "").replace(/ command$/, "");
    const find = (id: string) => acts.find((a) => a.id === id);
    const others = continueTargets(acts);

    // Around the conversation
    out.push(
      { type: "item", label: "Search in this chat", icon: <Search strokeWidth={1.5} />, onSelect: () => setSearchOpen(true) },
      { type: "item", label: p.showSteps ? "Hide the AI's steps" : "Show the AI's steps", icon: <ListTree strokeWidth={1.5} />, onSelect: p.onToggleSteps },
    );
    out.push({
      type: "sub",
      label: "Go to",
      icon: <ArrowDown strokeWidth={1.5} />,
      entries: [
        { type: "item", label: "First message", icon: <ArrowUp strokeWidth={1.5} />, onSelect: () => void goToFirst() },
        { type: "item", label: "Latest message", icon: <ArrowDown strokeWidth={1.5} />, onSelect: () => virt.scrollToEnd() },
        ...(p.onOverview ? ([{ type: "sep" }, { type: "item", label: "Back to Home", icon: <LayoutDashboard strokeWidth={1.5} />, onSelect: p.onOverview }] as Entry[]) : []),
      ],
    });
    out.push({ type: "sep" });

    // Continue it, copy it for an AI, save it
    if (others.length) out.push({ type: "sub", label: "Continue this chat in", icon: <ArrowRightLeft strokeWidth={1.5} />, entries: others.map((a) => asEntry(a, short(a))) });
    for (const id of ["copy-prompt", "copy-path"]) {
      const a = find(id);
      if (a) out.push(asEntry(a));
    }
    const moreCopies = ["copy-md", "copy-id", "fork"].map(find).filter((a): a is ChatAction => !!a);
    const commands = acts.filter((a) => a.group === "Copy" && a.id.startsWith("copy-") && !COPY_CONTENT_IDS.includes(a.id));
    const copyLabel: Record<string, string> = { "copy-md": "Markdown", "copy-id": "Chat ID" };
    out.push({
      type: "sub",
      label: "More copy options",
      icon: <Copy strokeWidth={1.5} />,
      entries: [
        ...moreCopies.map((a) => asEntry(a, copyLabel[a.id])),
        ...(commands.length ? ([{ type: "sep" }, { type: "label", label: "Copy the command to start" }, ...commands.map((a) => asEntry(a, short(a)))] as Entry[]) : []),
      ],
    });
    const saves = acts.filter((a) => a.group === "Save");
    if (saves.length) out.push({ type: "sub", label: "Save as", icon: <Save strokeWidth={1.5} />, entries: saves.map((a) => asEntry(a)) });
    out.push({ type: "sep" });

    // Keep it tidy
    out.push(
      { type: "item", label: "Rename", icon: <Pencil strokeWidth={1.5} />, onSelect: p.onRename },
      { type: "item", label: p.pinned ? "Unpin" : "Pin to top", icon: p.pinned ? <PinOff strokeWidth={1.5} /> : <Pin strokeWidth={1.5} />, onSelect: p.onTogglePin },
    );
    if (p.onArchive) out.push({ type: "item", label: chat.userArchived ? "Unarchive" : "Archive", icon: chat.userArchived ? <ArchiveRestore strokeWidth={1.5} /> : <Archive strokeWidth={1.5} />, onSelect: p.onArchive });
    out.push({ type: "sep" });

    // Elsewhere
    const open = acts.filter((a) => a.group === "Open");
    if (open.length) out.push({ type: "sub", label: "Open", icon: <FolderOpen strokeWidth={1.5} />, entries: open.map((a) => asEntry(a)) });
    if (p.onRefresh) out.push({ type: "item", label: "Refresh", icon: <RefreshCw strokeWidth={1.5} />, onSelect: p.onRefresh });
    out.push({ type: "sep" }, { type: "item", label: "Delete chat", icon: <Trash2 strokeWidth={1.5} />, danger: deleteKind(chat) !== "blocked", muted: deleteKind(chat) === "blocked", onSelect: p.onDelete });
    return out;
  };

  return (
    <GalleryContext.Provider value={gallery}>
    <FileViewContext.Provider value={fileCtx}>
    <StickyOpenContext.Provider value={openMemo}>
    <ContextArea className="flex min-h-0 flex-1 flex-col" entries={menuEntries} onError={(e) => p.toast(String(e))}>
    <div className="flex min-h-0 flex-1 flex-col">
      {viewer !== null && <Lightbox images={images} index={Math.min(viewer, images.length - 1)} onIndex={setViewer} onClose={() => setViewer(null)} />}
      {!page ? (
        <HeaderSkeleton />
      ) : (
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background/95 backdrop-blur px-4 sm:px-6 dark:border-white/[0.08] dark:bg-[#141618]">
          {/* Breadcrumb Navigation matching Mockup: Workspace (Amber) / Conversation Title */}
          <div className="mr-3 flex min-w-0 flex-1 items-center gap-2 text-[14px]">
            <span
              onClick={p.onOverview}
              className={cn(
                "max-w-[120px] shrink-0 truncate font-medium text-amber-700 transition-colors sm:max-w-[200px] dark:text-[#f0a83c]",
                p.onOverview && "cursor-pointer hover:underline"
              )}
            >
              {chat.project ? chat.project : "ChatVault"}
            </span>
            <span className="shrink-0 text-muted-foreground/40">/</span>
            <div className="group/title flex min-w-0 flex-1 items-center gap-1.5">
              <h2 className="truncate font-sans font-medium text-foreground">
                {prettyTitle(chat.title)}
              </h2>
              {p.live && (
                <Tip label={`${PROVIDER_SHORT[chat.provider]} is working in this chat right now`}>
                  <span className="relative flex size-2 shrink-0">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                  </span>
                </Tip>
              )}
              <button
                type="button"
                className="cursor-pointer p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/title:opacity-100"
                aria-label="Rename"
                onClick={p.onRename}
              >
                <Pencil className="size-3" />
              </button>
            </div>
          </div>

          {/* Right Header Controls matching Mockup: [ ↑ Export ] and [ ▷ Continue in... ▾ ] */}
          <div className="flex shrink-0 items-center gap-2">
            <ExportDropdown chat={chat} msgs={page.messages} toast={p.toast} />
            <ContinueMenu chat={chat} msgs={page.messages} toast={p.toast} />
          </div>
        </header>
      )}

      <div ref={wrapRef} className="relative min-h-0 flex-1">
        {page && searchOpen && (
          <div className="absolute right-6 top-3 z-20 w-[min(26rem,calc(100%-3rem))] rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg">
            <div className="flex items-center gap-1">
              <Search className="ml-2 size-4 shrink-0 text-muted-foreground" />
              <Input
                ref={searchRef}
                className="h-8 border-0 bg-transparent px-2 shadow-none focus-visible:ring-0"
                placeholder="Find in this chat"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && matches.length) setCur((c) => (e.shiftKey ? (c - 1 + matches.length) % matches.length : (c + 1) % matches.length));
                }}
              />
              <span className="shrink-0 px-1 text-xs tabular-nums text-muted-foreground">{query ? (loadingAll ? "…" : matches.length ? `${matchIndex + 1}/${matches.length}` : "0/0") : ""}</span>
              <Button variant="ghost" size="icon" className="size-7" aria-label="Previous match" disabled={!matches.length} onClick={() => setCur((c) => (c - 1 + matches.length) % matches.length)}>
                <ChevronUp className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="size-7" aria-label="Next match" disabled={!matches.length} onClick={() => setCur((c) => (c + 1) % matches.length)}>
                <ChevronDown className="size-4" />
              </Button>
              <Button variant="ghost" size="icon" className="size-7" aria-label="Close search" onClick={() => setSearchOpen(false)}>
                <X className="size-4" />
              </Button>
            </div>
          </div>
        )}

        <ScrollArea className="h-full" viewportClassName="[overflow-anchor:none]">
          {!page ? (
            <MessagesSkeleton />
          ) : (
            <div className="mx-auto max-w-3xl px-4 pb-10 pt-4">
              {page.partial && (
                <div className="flex items-center justify-center gap-2 pb-7 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Loading…
                </div>
              )}
              {!page.partial && page.start > 0 && (
                <div className="flex justify-center pb-7">
                  <Button size="sm" variant="outline" onClick={p.onLoadEarlier} disabled={p.loadingEarlier}>
                    {p.loadingEarlier ? <Loader2 className="size-4 animate-spin" /> : <ChevronUp className="size-4" />}
                    Load earlier messages ({page.start.toLocaleString()} more)
                  </Button>
                </div>
              )}
              <div ref={listRef} className="relative w-full" style={{ height: virt.getTotalSize() }}>
                {virt.getVirtualItems().map((vi) => {
                  const b = blocks[vi.index];
                  if (!b) return null;
                  const isUser = b.kind === "msg" && b.m.role === "user";

                  if (isUser) {
                    return (
                      <div key={vi.key} data-index={vi.index} ref={virt.measureElement} className="absolute left-0 top-0 w-full pb-4" style={{ transform: `translateY(${vi.start - margin}px)` }}>
                        <UserRow m={b.m} q={query} isCurrentMatch={matchIndex >= 0 && matches[matchIndex] === b.i} rowKey={String(vi.key)} />
                      </div>
                    );
                  }

                  const prev = blocks[vi.index - 1];
                  const isFirstInTurn = vi.index === 0 || (prev?.kind === "msg" && prev.m.role === "user");
                  const time = isFirstInTurn ? getTurnTime(vi.index, blocks) : "";

                  return (
                    <div key={vi.key} data-index={vi.index} ref={virt.measureElement} className="absolute left-0 top-0 w-full pb-3" style={{ transform: `translateY(${vi.start - margin}px)` }}>
                      {isFirstInTurn && (
                        <AssistantTurnHeader provider={logoProvider} time={time} />
                      )}
                      <div className="ml-[13px] border-l-2 border-[#a3e635] pl-4">
                        {b.kind === "plan" ? (
                          <div className="my-1"><PlanBlock item={b.m} memoKey={String(vi.key)} /></div>
                        ) : b.kind === "agent" ? (
                          <div className="my-1"><SubagentBlock item={b.m} memoKey={String(vi.key)} /></div>
                        ) : b.kind === "trace" ? (
                          <StepsTrace items={b.items} q={query} rowKey={String(vi.key)} />
                        ) : (
                          <AssistantMessage m={b.m} q={query} isCurrentMatch={matchIndex >= 0 && matches[matchIndex] === b.i} rowKey={String(vi.key)} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              {p.live && (
                <div className="flex items-center gap-3 pt-2" aria-live="polite">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <ProviderLogo provider={logoProvider} className="size-5 animate-pulse" />
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="animate-pulse">{PROVIDER_SHORT[logoProvider]} is working</span>
                    <span className="flex gap-[3px]">
                      {[0, 200, 400].map((d) => (
                        <span key={d} className="size-[3px] animate-pulse rounded-full bg-muted-foreground/60" style={{ animationDelay: `${d}ms`, animationDuration: "1.4s" }} />
                      ))}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        <div className={cn("pointer-events-none absolute inset-x-0 top-0 z-10 h-12 bg-gradient-to-b from-background via-background/70 to-transparent transition-opacity duration-200", atTop ? "opacity-0" : "opacity-100")} />
        <div className={cn("pointer-events-none absolute inset-x-0 bottom-0 z-10 h-20 bg-gradient-to-t from-background via-background/70 to-transparent transition-opacity duration-200", atEnd ? "opacity-0" : "opacity-100")} />

        {showJump && (
          <Button
            size="icon"
            aria-label="Scroll to the bottom"
            className="absolute bottom-4 left-1/2 z-20 size-9 -translate-x-1/2 rounded-full shadow-md"
            onClick={() => virt.scrollToEnd()}
          >
            <ArrowDown className="size-4" />
          </Button>
        )}
      </div>

      {/* Bottom Composer directly inside the chat window matching Mockup */}
      <div className="shrink-0 pb-5 pt-2">
        <div className="mx-auto max-w-3xl px-4">
          <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-muted/50 p-2 shadow-xs transition-colors dark:border-white/10 dark:bg-[#16181b]">
            <div className="flex h-10 flex-1 items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 shadow-xs transition-colors focus-within:border-ring dark:border-white/[0.08] dark:bg-[#1f2227] dark:focus-within:border-white/20">
              <GitBranch className="size-4 shrink-0 text-muted-foreground" />
              <input
                type="text"
                placeholder="Continue this conversation in another agent…"
                value={composerText}
                onChange={(e) => setComposerText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleHandoff();
                  }
                }}
                className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none font-sans"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleHandoff()}
              disabled={handoffBusy}
              className="flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-xl bg-[#f0a83c] px-4 text-[13px] font-semibold text-[#120d04] transition-colors hover:bg-[#f5b85a] disabled:opacity-50 font-sans"
            >
              {handoffBusy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Create handoff
            </button>
          </div>
        </div>
      </div>
    </div>
      <FileViewer path={fileOpen} base={chat.cwd ?? null} hints={fileHints} onClose={() => setFileOpen(null)} />
    </ContextArea>
    </StickyOpenContext.Provider>
    </FileViewContext.Provider>
    </GalleryContext.Provider>
  );
}


/** Continue in... button matching Mockup [ ▷ Continue in... ▾ ] */
function ContinueMenu({ chat, msgs, toast }: { chat: Chat; msgs: Msg[]; toast: (m: string) => void }) {
  const all = chatActions(chat, toast, msgs);
  const targets = continueTargets(all);
  const promptAction = all.find((a) => a.id === "copy-prompt");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground shadow-xs transition-colors hover:bg-muted dark:border-white/10 dark:bg-[#1a1c1e] dark:hover:bg-[#25282c]"
          >
            <Play className="size-3 fill-current text-muted-foreground" />
            <span>Continue in…</span>
            <ChevronDown className="size-3 opacity-60" />
          </button>
        }
      />
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-56 rounded-xl border border-border bg-popover p-1.5 shadow-xl text-popover-foreground dark:border-white/10 dark:bg-[#16181a] dark:text-foreground"
      >
        {targets.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Launch in tool
            </DropdownMenuLabel>
            {targets.map((a) => (
              <DropdownMenuItem
                key={a.id}
                onClick={() => void runAction(a.label, a.run)}
                className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors focus:bg-muted focus:text-foreground dark:focus:bg-[#25282c] dark:focus:text-[#f0a83c]"
              >
                <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                  {sourceGlyph(a.logo, "size-4") ?? <ActionIcon action={a} className="size-4" />}
                </span>
                <span>{a.label.replace(/^Continue in /, "")}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
        {promptAction && (
          <>
            <DropdownMenuSeparator className="my-1 bg-border dark:bg-white/[0.08]" />
            <DropdownMenuItem
              onClick={() => void runAction(promptAction.label, promptAction.run)}
              className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors focus:bg-muted focus:text-foreground dark:focus:bg-[#25282c] dark:focus:text-[#f0a83c]"
            >
              <MessageSquareText className="size-4 shrink-0 text-muted-foreground" />
              <span>Copy handoff prompt</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Export dropdown matching Mockup [ ↑ Export ] */
function ExportDropdown({ chat, msgs, toast }: { chat: Chat; msgs: Msg[]; toast: (m: string) => void }) {
  const all = chatActions(chat, toast, msgs);
  const isCommand = (a: ChatAction) => a.group === "Copy" && a.id.startsWith("copy-") && !COPY_CONTENT_IDS.includes(a.id);
  const copies = all.filter((a) => a.group === "Copy" && !isCommand(a));
  const saves = all.filter((a) => a.group === "Save");
  const commands = all.filter(isCommand);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground shadow-xs transition-colors hover:bg-muted dark:border-white/10 dark:bg-[#1a1c1e] dark:hover:bg-[#25282c]"
          >
            <ArrowUp className="size-3.5 text-muted-foreground" />
            <span>Export</span>
          </button>
        }
      />
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-56 rounded-xl border border-border bg-popover p-1.5 shadow-xl text-popover-foreground dark:border-white/10 dark:bg-[#16181a] dark:text-foreground"
      >
        {copies.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Copy Content
            </DropdownMenuLabel>
            {copies.map((a) => (
              <DropdownMenuItem
                key={a.id}
                onClick={() => void runAction(a.label, a.run)}
                className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors focus:bg-muted focus:text-foreground dark:focus:bg-[#25282c] dark:focus:text-[#f0a83c]"
              >
                <a.icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                <span>{a.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        )}
        {saves.length > 0 && (
          <>
            <DropdownMenuSeparator className="my-1 bg-border dark:bg-white/[0.08]" />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Save File
              </DropdownMenuLabel>
              {saves.map((a) => (
                <DropdownMenuItem
                  key={a.id}
                  onClick={() => void runAction(a.label, a.run)}
                  className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors focus:bg-muted focus:text-foreground dark:focus:bg-[#25282c] dark:focus:text-[#f0a83c]"
                >
                  <a.icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                  <span>{a.label}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
        {commands.length > 0 && (
          <>
            <DropdownMenuSeparator className="my-1 bg-border dark:bg-white/[0.08]" />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                CLI Command
              </DropdownMenuLabel>
              {commands.map((a) => (
                <DropdownMenuItem
                  key={a.id}
                  onClick={() => void runAction(a.label, a.run)}
                  className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors focus:bg-muted focus:text-foreground dark:focus:bg-[#25282c] dark:focus:text-[#f0a83c]"
                >
                  <a.icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                  <span>{a.label.replace(/^Copy /, "").replace(/ command$/, "")}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatMsgTime(ts?: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Today · ${timeStr}`;
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `Yesterday · ${timeStr}`;
  const dateStr = d.toLocaleDateString([], { day: "numeric", month: "short" });
  return `${dateStr} · ${timeStr}`;
}

function getTurnTime(idx: number, blocksList: Block[]): string {
  for (let curr = idx; curr < blocksList.length; curr++) {
    const blk = blocksList[curr];
    if (blk.kind === "msg" && blk.m.role === "user") break;
    const ts = blk.kind === "trace" ? blk.items[0]?.m.ts : blk.m.ts;
    if (ts) return formatMsgTime(ts);
  }
  return "";
}

function AssistantTurnHeader({ provider, time }: { provider: Provider; time: string }) {
  return (
    <div className="flex items-center gap-3 mb-2.5">
      <div className="flex size-7 shrink-0 items-center justify-center text-[#f0a83c]">
        {sourceGlyph(provider, "size-5 text-[#f0a83c]") ?? <ProviderLogo provider={provider} className="size-5 text-[#f0a83c]" />}
      </div>
      <span className="font-semibold text-foreground text-[13px]">Assistant</span>
      <span className="text-[12px] text-muted-foreground">{time}</span>
    </div>
  );
}

/** Tool step pill matching Mockup [ ⌄ Inspected OpenCode SQLite schema   ✔ ] */
const StepsTrace = memo(function StepsTrace({ items, q, rowKey }: { items: { i: number; m: Item }[]; q: string; rowKey: string }) {
  const [open, setOpen] = useStickyOpen(rowKey);
  const hasMatch = !!q && items.some((t) => textHas(t.m.text, q));
  const names = Array.from(new Set(items.map((t) => stepName(t.m))));
  const summary = names.slice(0, 3).join(", ") || `${items.length} ${items.length === 1 ? "step" : "steps"}`;

  return (
    <div className="my-2.5">
      <div className="rounded-lg border border-border bg-card shadow-xs text-[13px] transition-colors hover:border-border/80 hover:bg-muted/40 dark:border-white/10 dark:bg-[#1a1c1e] dark:hover:border-white/20">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex w-full cursor-pointer items-center justify-between px-3.5 py-2.5 text-left font-sans"
        >
          <div className="flex items-center gap-2 text-foreground/90">
            {open ? <ChevronDown className="size-4 text-muted-foreground" /> : <ChevronRight className="size-4 text-muted-foreground" />}
            <span className="font-medium">{summary}</span>
          </div>
          <span className="flex size-5 items-center justify-center rounded-full bg-[#a3e635] text-black">
            <Check className="size-3" strokeWidth={3} />
          </span>
        </button>
        {(open || hasMatch) && (
          <div className="border-t border-border bg-muted/40 p-3 space-y-1.5 font-sans dark:border-white/[0.06] dark:bg-[#141618]/60">
            {items.map(({ i, m }) => (
              <StepItem key={i} item={m} q={q} memoKey={`${rowKey}|${m.id ?? m.ts ?? i}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

const UserRow = memo(function UserRow({
  m,
  q,
  isCurrentMatch,
  rowKey,
}: {
  m: Msg;
  q: string;
  isCurrentMatch: boolean;
  rowKey: string;
}) {
  const [open, setOpen] = useStickyOpen(rowKey);
  const timeFormatted = formatMsgTime(m.ts);
  const long = m.text.length > 1800;
  const expanded = open || !!q;
  const text = long && !expanded ? m.text.slice(0, 1800) + "…" : m.text;

  return (
    <div className="group/msg flex w-full flex-col border-b border-border/60 pb-6 mb-2 dark:border-white/[0.08]">
      <div className="flex w-full items-start gap-3.5">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground dark:border-white/15 dark:bg-white/[0.04]">
          <User className="size-3.5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="font-semibold text-foreground">You</span>
            <span className="text-[12px] text-muted-foreground">{timeFormatted}</span>
          </div>
          <div className="font-sans text-[14px] leading-relaxed text-foreground/90">
            {m.kind === "image" && typeof m.data === "string" ? (
              <ChatImage src={m.data} />
            ) : (
              <MessageBody text={text} q={q} active={isCurrentMatch} assistant={false} />
            )}
            {long && !q && (
              <button className="mt-1 cursor-pointer font-sans text-xs text-muted-foreground underline" onClick={() => setOpen((o) => !o)}>
                {open ? "Show less" : "Show all"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

const AssistantMessage = memo(function AssistantMessage({
  m,
  q,
  isCurrentMatch,
  rowKey,
}: {
  m: Msg;
  q: string;
  isCurrentMatch: boolean;
  rowKey: string;
}) {
  const [open, setOpen] = useStickyOpen(rowKey);
  const long = m.text.length > 1800;
  const expanded = open || !!q;
  const text = long && !expanded ? m.text.slice(0, 1800) + "…" : m.text;

  if (m.kind === "summary") {
    return (
      <div className="my-2 rounded-lg border border-dashed border-border p-3 text-sm font-sans dark:border-white/10">
        <button className="flex cursor-pointer items-center gap-1.5 text-muted-foreground" onClick={() => setOpen((o) => !o)}>
          {open || q ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          Earlier part was summarized here
        </button>
        {(open || q) && (
          <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-muted-foreground">
            <Highlight text={m.text} q={q} activeMark={isCurrentMatch} />
          </pre>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 py-0.5">
      <div className="font-sans text-[14px] leading-relaxed text-foreground/90">
        {m.kind === "image" && typeof m.data === "string" ? (
          <ChatImage src={m.data} />
        ) : (
          <MessageBody text={text} q={q} active={isCurrentMatch} assistant={true} />
        )}
        {long && !q && (
          <button className="mt-1 cursor-pointer font-sans text-xs text-muted-foreground underline" onClick={() => setOpen((o) => !o)}>
            {open ? "Show less" : "Show all"}
          </button>
        )}
      </div>
    </div>
  );
});

