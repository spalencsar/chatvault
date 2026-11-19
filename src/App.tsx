import { lazy, Suspense, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Archive,
  Tag,
  ArchiveRestore,
  ArrowRightLeft,
  Copy,
  ChevronRight,
  Layers,
  DatabaseBackup,
  Eye,
  FilePlus2,
  FolderOpen,
  Settings as SettingsIcon,
  Trash2,
  ArrowUpDown,
  ChevronsUpDown,
  ListFilter,
  PanelLeft,
  RotateCcw,
  LayoutDashboard,
  Loader2,
  Moon,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Save,
  Search,
  Star,
  Sun,
} from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { AppToaster, notify, notifyError, runAction } from "@/toast";
import { initBulkExport } from "@/bulk-export";
import { describeImport, importNousSave } from "@/import-noussave";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import { ContextArea, type Entry } from "@/context-area";
import { NavSidebar, type SourceRow, type SourceSubItem, type WorkspaceRow } from "@/nav-sidebar";
import { ProviderLogo, VaultLogo } from "@/claude-logo";
import { sourceGlyph } from "@/source-icons";
import { Badge } from "@/components/ui/badge";
import { ActionIcon } from "@/action-icon";
import { ChatCard } from "@/chat-card";
import { CORE_PROVIDERS, PROVIDERS, setOffTools, setCustomAccountNames, originalAccountLabel, type Tool, PROVIDER_NAME, isHandoffOnly, deleteKind, deleteBlockedMessage, accountLabel, chatActions, continueTargets, COPY_CONTENT_IDS, setAccountNames, type AccountInfo, type Chat, type ChatAction, type Msg, type MsgPage, type Provider } from "@/chat-actions";
import { FadedScroll } from "@/faded-scroll";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarSkeleton, MessagesSkeleton } from "@/skeletons";
import { Splash } from "@/splash";
import { TitleBar } from "@/titlebar";
import { AUTO_SYNC_KEY, AUTO_SYNC_INTERVAL_KEY } from "@/store";
import { chatKey, useAccountNames, useChatMeta, usePersisted } from "@/store";
import { RenameAccountDialog } from "@/rename-account-dialog";
import { startAutoUpdate } from "@/updater";
// Keep the shell independent of chat rendering, charts and closed dialogs.
const ChatView = lazy(() => import("@/chat-view").then((m) => ({ default: m.ChatView })));
const OverviewPage = lazy(() => import("@/overview").then((m) => ({ default: m.OverviewPage })));
const CommandPalette = lazy(() => import("@/command-palette").then((m) => ({ default: m.CommandPalette })));
const GlobalSearch = lazy(() => import("@/global-search").then((m) => ({ default: m.GlobalSearch })));
const TagsDialog = lazy(() => import("@/tags-dialog").then((m) => ({ default: m.TagsDialog })));
const SyncDialog = lazy(() => import("@/sync-dialog").then((m) => ({ default: m.SyncDialog })));
const SettingsDialog = lazy(() => import("@/settings-dialog").then((m) => ({ default: m.SettingsDialog })));
const MoveBackupDialog = lazy(() => import("@/move-backup-dialog").then((m) => ({ default: m.MoveBackupDialog })));

const PAGE_SIZE = 20;
const MSG_PAGE = 80;

type Overview = { total: number; accounts: { id: string; count: number }[]; latestMs: number | null };
type Hit = { id: string; snippet: string };
type IndexProg = { phase: string; done: number; total: number };

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * A workspace as a title: "chat-vault" becomes "ChatVault" — the separator disappears and every part starts
 * with a capital, so a folder name reads as one name instead of "Chat Vault".
 */
function workspaceTitle(name: string) {
  return name
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
}

function groupByPlatform(list: Chat[]): [string, Chat[]][] {
  const map = new Map<string, Chat[]>();
  for (const c of list) {
    const key = c.account || "Other";
    const group = map.get(key) ?? [];
    group.push(c);
    map.set(key, group);
  }
  return [...map.entries()];
}

export default function App() {
  const [provider, setProvider] = usePersisted<Tool>("chatvault.provider", "claude");
  const [accounts, setAccounts] = usePersisted<Record<string, string>>("chatvault.accounts", {});
  const [showSteps, setShowSteps] = usePersisted("chatvault.steps", true);
  const [sort, setSort] = usePersisted("chatvault.sort", "recent");
  const [scope, setScope] = usePersisted("chatvault.scope", "all");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [view, setView] = useState<"dashboard" | "chats">("dashboard");
  const [sidebarOpen, setSidebarOpen] = usePersisted("chatvault.sidebar", true);
  // The selected workspace filters the list to one project folder (name + folder, because names repeat).
  const [project, setProject] = usePersisted<string | null>("chatvault.nav.activeProject", null);
  const [projectCwd, setProjectCwd] = usePersisted<string | null>("chatvault.nav.activeCwd", null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRow[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  // The browser's Starred pill shows only the chats the user pinned.
  const [starredOnly, setStarredOnly] = useState(false);
  const [headerOpen, setHeaderOpen] = usePersisted("chatvault.headerOpen", true);
  const [todayOpen] = usePersisted("chatvault.sec.today", true);
  const [yesterdayOpen] = usePersisted("chatvault.sec.yesterday", true);
  const [recentOpen] = usePersisted("chatvault.sec.recent", true);
  const [dark, setDark] = useState(() => localStorage.getItem("theme") !== "light");
  const { pins, names, togglePin, rename } = useChatMeta();
  const { accountNames, renameAccount } = useAccountNames();
  setCustomAccountNames(accountNames);
  const [renamingAccount, setRenamingAccount] = useState<string | null>(null);

  const [overview, setOverview] = useState<Record<Provider, Overview | null>>({ claude: null, codex: null, cursor: null, gemini: null, opencode: null, cline: null, grok: null, hermes: null, antigravity: null, imported: null });
  const [accountInfo, setAccountInfo] = useState<AccountInfo[]>([]);
  const account = provider === "all" ? "all" : accounts[provider] ?? "all";
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Chat[]>([]);
  const [pinned, setPinned] = useState<Chat[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingList, setLoadingList] = useState(true);
  const [searchAll, setSearchAll] = useState(false);
  const [searchSeed, setSearchSeed] = useState("");
  /** Opens the search page, optionally with a word already typed. */
  const openSearch = useCallback((q = "") => {
    setSearchSeed(q);
    setSearchAll(true);
  }, []);
  const [tagging, setTagging] = useState<Chat | null>(null);
  const [tagList, setTagList] = useState<[string, number][]>([]);
  // The HTML boot screen covers module loading; hand over to the shell on its first frame.
  const [splash, setSplash] = useState<"on" | "leaving" | "off">("on");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (isTauri) initBulkExport();
  }, []);
  // A failed scan or query used to disappear silently; it now shows as an error toast.
  useEffect(() => {
    if (error) notifyError(error);
  }, [error]);
  const [hits, setHits] = useState<Record<string, string> | null>(null);
  const [searching, setSearching] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [indexing, setIndexing] = useState<IndexProg | null>(null);
  const [selected, setSelected] = useState<Chat | null>(null);
  const [page, setPageState] = useState<MsgPage | null>(null);
  const pageRef = useRef<MsgPage | null>(null);
  // Async readers and live updates see the same page before React's next render.
  const setPage = useCallback((next: MsgPage | null | ((current: MsgPage | null) => MsgPage | null)) => {
    const value = typeof next === "function" ? next(pageRef.current) : next;
    pageRef.current = value;
    setPageState(value);
  }, []);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Tools switched off in Settings are left out of every list. This only makes the screen redraw when that changes.
  const [, setOffTick] = useState(0);
  const applyOff = useCallback(async () => {
    const list = await invoke<string[]>("disabled_integrations").catch(() => [] as string[]);
    setOffTools(list);
    setOffTick((n) => n + 1);
    return list;
  }, []);
  useEffect(() => {
    void applyOff();
  }, [applyOff]);
  const [movePending, setMovePending] = useState<{ path: string; filesToMove: number; bytesToMove: number; isExistingBackup: boolean } | null>(null);
  const [renaming, setRenaming] = useState<Chat | null>(null);
  const [deleting, setDeleting] = useState<Chat | null>(null);
  const [organize, setOrganize] = usePersisted("chatvault.organize", "list");
  // Expand/collapse-all sets a mode; single clicks are exceptions to it, so projects that load later follow the mode too.
  const [projectsMode, setProjectsMode] = usePersisted<"open" | "closed">("chatvault.projectsMode", "open");
  const [projectExceptions, setProjectExceptions] = usePersisted<string[]>("chatvault.projectExceptions", []);
  // Collapsed projects render no chats; hovering one warms it up so it opens instantly.
  const [warmProjects, setWarmProjects] = useState<Set<string>>(new Set());
  const projectOpen = useCallback((n: string) => (projectsMode === "open") !== projectExceptions.includes(n), [projectsMode, projectExceptions]);

  const say = useCallback((m: string) => void notify(m), []);
  // The browser's own right-click menu (Back, Reload, Inspect) makes no sense in an app. Text fields keep their copy and paste menu.
  useEffect(() => {
    if (import.meta.env.DEV) return;
    const block = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) e.preventDefault();
    };
    document.addEventListener("contextmenu", block);
    return () => document.removeEventListener("contextmenu", block);
  }, []);
  // A failed list load is reported as a toast, not as text inside the sidebar.
  useEffect(() => {
    if (error) notifyError(error);
  }, [error]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const named = useCallback((c: Chat): Chat => (names[chatKey(c)] ? { ...c, title: names[chatKey(c)] } : c), [names]);
  const pinSet = useMemo(() => new Set(pins), [pins]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    const t = window.setTimeout(() => setQ(query.trim()), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  // Scan the disk (only new and changed chats are read), then reload what is on screen.
  const rescan = useCallback(async () => {
    if (!isTauri) return;
    setIndexing({ phase: "Scanning", done: 0, total: 0 });
    try {
      const a = await invoke<AccountInfo[]>("account_info");
      setAccountNames(a);
      setAccountInfo(a);
      await invoke("refresh_index");
    } catch (e) {
      setError(String(e));
    } finally {
      setIndexing(null);
      setReloadKey((k) => k + 1);
      // The words inside chats are indexed quietly in the background so searching is instant.
      void invoke("build_search_index").catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    const un = listen<IndexProg>("index-progress", (e) => setIndexing(e.payload.phase === "Done" ? null : e.payload));
    let cancelled = false;
    // Paint cached chats first; StrictMode cleanup cancels the first scheduled run.
    const startup = window.setTimeout(() => {
      void (async () => {
        await rescan();
        if (cancelled || localStorage.getItem(AUTO_SYNC_KEY) === "0") return;
        const result = await invoke<{ copied: number }>("sync_chats").catch(() => null);
        if (!cancelled && result && result.copied > 0) await rescan();
      })();
    }, 750);
    const intervalMin = parseInt(localStorage.getItem(AUTO_SYNC_INTERVAL_KEY) || "10", 10);
    const intervalMs = (isNaN(intervalMin) || intervalMin < 1 ? 10 : intervalMin) * 60 * 1000;
    const every = window.setInterval(() => {
      if (localStorage.getItem(AUTO_SYNC_KEY) !== "0") void invoke("sync_chats").then(() => rescan()).catch(() => {});
    }, intervalMs);
    const stopUpdates = startAutoUpdate();
    const offSync = listen("tray-sync", () => setSyncOpen(true));
    const offScan = listen("tray-rescan", () => void rescan());
    const offSearch = listen("tray-search", () => setPaletteOpen(true));
    const offSettings = listen("tray-settings", () => setSettingsOpen(true));
    return () => {
      cancelled = true;
      window.clearTimeout(startup);
      void un.then((f) => f());
      void offSync.then((f) => f());
      void offScan.then((f) => f());
      void offSearch.then((f) => f());
      void offSettings.then((f) => f());
      window.clearInterval(every);
      stopUpdates();
    };
  }, [rescan]);

  useEffect(() => {
    if (!isTauri) return;
    PROVIDERS.forEach((p) =>
      invoke<Overview>("provider_overview", { provider: p })
        .then((o) => setOverview((s) => ({ ...s, [p]: o })))
        .catch(() => {}),
    );
  }, [reloadKey]);

  // The nav column: one row per project folder, counts for the current source and scope.
  useEffect(() => {
    if (!isTauri) return;
    let stale = false;
    setLoadingWorkspaces(true);
    invoke<WorkspaceRow[]>("workspaces", { provider, scope })
      .then((w) => {
        if (stale) return;
        setWorkspaces(w);
        setProject((current) => current ?? (w[0]?.project ?? null));
        setProjectCwd((current) => current ?? (w[0]?.cwd ?? null));
      })
      .catch(() => {})
      .finally(() => !stale && setLoadingWorkspaces(false));
    return () => {
      stale = true;
    };
  }, [provider, scope, reloadKey]);

  // Pinned chats of the current tool.
  useEffect(() => {
    if (!isTauri) return;
    const byTool = new Map<string, string[]>();
    for (const k of pins) {
      const at = k.indexOf(":");
      const p = k.slice(0, at);
      if (provider === "all" || p === provider) byTool.set(p, [...(byTool.get(p) ?? []), k.slice(at + 1)]);
    }
    if (!byTool.size) {
      setPinned([]);
      return;
    }
    Promise.all([...byTool].map(([p, ids]) => invoke<Chat[]>("chats_by_ids", { provider: p, ids }).catch(() => [] as Chat[])))
      .then((lists) => setPinned(lists.flat().sort((a, b) => b.lastMs - a.lastMs)))
      .catch(() => {});
  }, [pins, provider, reloadKey]);

  // First page of the list whenever the tool, account, search or index changes.
  const searchingAll = q.length >= 2;
  useEffect(() => {
    if (!isTauri || searchingAll) return;
    let stale = false;
    setLoadingList(true);
    setHits(null);
    invoke<{ items: Chat[]; total: number }>("query_chats", { provider, account, q, offset: 0, limit: PAGE_SIZE, sort, scope, project, cwd: projectCwd })
      .then((r) => {
        if (stale) return;
        setItems(r.items);
        setTotal(r.total);
        setError(null);
      })
      .catch((e) => !stale && setError(String(e)))
      .finally(() => !stale && setLoadingList(false));
    return () => {
      stale = true;
    };
  }, [provider, account, q, sort, scope, project, projectCwd, reloadKey, searchingAll]);

  // Searching looks in every tool at once: matching titles and projects, plus the words inside the chats (instant, from the search index).
  useEffect(() => {
    if (!isTauri || !searchingAll) return;
    let stale = false;
    setSearching(true);
    void (async () => {
      try {
        const per = await Promise.all(
          PROVIDERS.map(async (p) => {
            const [titles, words] = await Promise.all([
              invoke<{ items: Chat[] }>("query_chats", { provider: p, account: "all", q, offset: 0, limit: 30, sort: "recent", scope: "all" }).then((r) => r.items).catch(() => [] as Chat[]),
              invoke<Hit[]>("deep_search", { provider: p, query: q }).catch(() => [] as Hit[]),
            ]);
            const inside = words.length ? await invoke<Chat[]>("chats_by_ids", { provider: p, ids: words.slice(0, 40).map((h) => h.id) }).catch(() => [] as Chat[]) : [];
            return { titles, inside, words };
          }),
        );
        if (stale) return;
        const snippets: Record<string, string> = {};
        const seen = new Set<string>();
        const list: Chat[] = [];
        per.forEach(({ titles, inside, words }) => {
          words.forEach((h) => (snippets[h.id] = h.snippet));
          [...titles, ...inside].forEach((c) => {
            const k = chatKey(c);
            if (!seen.has(k)) {
              seen.add(k);
              list.push(c);
            }
          });
        });
        // The workspace keeps ruling: a search narrows inside it instead of overruling it.
        const scoped = list.filter((c) => (!project || c.project === project) && (!projectCwd || c.cwd === projectCwd));
        scoped.sort((x, y) => y.lastMs - x.lastMs);
        setItems(scoped);
        setTotal(scoped.length);
        setHits(snippets);
        setError(null);
        setLoadingList(false);
      } finally {
        if (!stale) setSearching(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [q, searchingAll, reloadKey, project, projectCwd]);

  useEffect(() => {
    let timer: number | undefined;
    const frame = requestAnimationFrame(() => {
      setSplash("leaving");
      timer = window.setTimeout(() => setSplash("off"), 320);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  const loadingMore = useRef(false);
  const loadMore = useCallback(async () => {
    if (loadingMore.current || hits || searchingAll) return;
    loadingMore.current = true;
    try {
      const r = await invoke<{ items: Chat[]; total: number }>("query_chats", { provider, account, q, offset: items.length, limit: PAGE_SIZE, sort, scope });
      setItems((cur) => [...cur, ...r.items]);
      setTotal(r.total);
    } finally {
      loadingMore.current = false;
    }
  }, [provider, account, q, sort, scope, items.length, hits, searchingAll]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const hasMore = !hits && items.length < total;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    let timer: number | undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && timer === undefined) {
        timer = window.setTimeout(() => {
          timer = undefined;
          void loadMore();
        }, 250);
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, [hasMore, loadMore, items.length, recentOpen, todayOpen, yesterdayOpen]);

  const openId = useRef(0);
  const [outline, setOutline] = useState<{ ts: string; text: string }[] | null>(null);
  const [searchTarget, setSearchTarget] = useState<string>("");
  const open = useCallback(
    (chat: Chat, searchWord?: string) => {
      const id = ++openId.current;
      setSearchAll(false);
      setSelected(chat);
      setSearchTarget(searchWord ?? "");
      setPage(null);
      setOutline(null);
      // A light outline of the whole chat for the timeline, built in the background; only a few short lines come back.
      invoke<{ ts: string; text: string }[]>("chat_outline", { provider: chat.provider, path: chat.path })
        .then((o) => {
          if (openId.current === id) setOutline(o);
        })
        .catch(() => {});
      // The newest messages come first, read from the end of the file, so the chat is readable at once.
      invoke<Msg[]>("read_chat_tail", { provider: chat.provider, path: chat.path, limit: MSG_PAGE })
        .then((messages) => {
          if (openId.current === id) setPage((cur) => cur ?? { messages, total: messages.length, start: 0, partial: true });
        })
        .catch(() => {});
      // The real total follows; earlier messages are only read as you scroll up toward them.
      invoke<MsgPage>("read_chat_page", { provider: chat.provider, path: chat.path, before: null, limit: MSG_PAGE })
        .then((r) => {
          if (openId.current === id) setPage(r);
        })
        .catch((e) => {
          if (openId.current !== id) return;
          setPage((cur) => (cur ? { ...cur, partial: false } : { messages: [], total: 0, start: 0 }));
          say(String(e));
        });
    },
    [say],
  );

  // Keep the open chat live: when its file grows, only the new messages are read and added at the bottom.
  // A fork is a new file next to the original: index it, name it, and open it, all without a terminal.
  useEffect(() => {
    const onFork = async (e: Event) => {
      const d = (e as CustomEvent<{ from: Chat; id: string; path: string }>).detail;
      try {
        await invoke("refresh_index");
        setReloadKey((k) => k + 1);
        const r = await invoke<{ items: Chat[] }>("query_chats", { provider: d.from.provider, account: "all", q: "", offset: 0, limit: 40, sort: "recent", scope: "all" });
        const made = r.items.find((c) => c.id === d.id);
        if (made) {
          rename(chatKey(made), `${names[chatKey(d.from)] || d.from.title} (fork)`);
          setProvider(made.provider);
          open(made);
        }
      } catch (err) {
        say(String(err));
      }
    };
    window.addEventListener("chatvault:forked", onFork);
    return () => window.removeEventListener("chatvault:forked", onFork);
  }, [rename, names, open, say]);

  // Chats an agent is writing to right now (their file changed in the last 20 seconds) get a green dot in the list.
  const [liveKeys, setLiveKeys] = useState<Set<string>>(new Set());
  const listed = useRef<Chat[]>([]);
  listed.current = [...pinned, ...items];
  useEffect(() => {
    let busy = false;
    const tick = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const seen = new Map<string, Chat>();
        listed.current.forEach((c) => !isHandoffOnly(c.provider) && !c.path.startsWith("archive:") && seen.set(chatKey(c), c));
        const chats = [...seen.values()];
        const ms = await invoke<number[]>("chat_stamps", { items: chats.map((c) => [c.provider, c.path]) });
        const now = Date.now();
        const next = new Set<string>();
        chats.forEach((c, i) => ms[i] && now - ms[i] < 20000 && next.add(chatKey(c)));
        setLiveKeys((cur) => (cur.size === next.size && [...next].every((k) => cur.has(k)) ? cur : next));
      } catch {
        /* try again next time */
      } finally {
        busy = false;
      }
    };
    void tick();
    const id = window.setInterval(tick, 3000);
    return () => window.clearInterval(id);
  }, []);

  // Every tool: new conversations and new messages show up on their own. A new file is picked up at once;
  // changes inside existing chats are folded in at most every 15 seconds.
  // Refreshes the list in place: keeps as many rows as are already shown, so the sidebar does not jump back to the top.
  const listArgs = useRef({ provider, account, q, sort, scope, count: 0 });
  listArgs.current = { provider, account, q, sort, scope, count: items.length };
  const quietReload = useCallback(async () => {
    const l = listArgs.current;
    const r = await invoke<{ items: Chat[]; total: number }>("query_chats", { provider: l.provider, account: l.account, q: l.q, offset: 0, limit: Math.min(300, Math.max(PAGE_SIZE, l.count)), sort: l.sort, scope: l.scope });
    setItems(r.items);
    setTotal(r.total);
  }, []);
  const cursorFp = useRef(0);
  const cursorChanged = useRef(0);
  const filesFp = useRef<[number, number] | null>(null);
  const lastRefresh = useRef(0);
  useEffect(() => {
    if (!isTauri) return;
    let busy = false;
    const id = window.setInterval(async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const [fp, ff] = await Promise.all([invoke<number>("cursor_fingerprint"), invoke<[number, number]>("files_fingerprint")]);
        const cursorMoved = cursorFp.current !== 0 && fp !== cursorFp.current;
        const prev = filesFp.current;
        const fresh = !!prev && ff[0] !== prev[0];
        const grew = !!prev && ff[1] !== prev[1] && Date.now() - lastRefresh.current > 15000;
        cursorFp.current = fp;
        filesFp.current = ff;
        if (cursorMoved) cursorChanged.current = Date.now();
        if (cursorMoved || fresh || grew) {
          lastRefresh.current = Date.now();
          await invoke("refresh_index");
          void invoke("build_search_index").catch(() => {});
          await quietReload();
          const sel = selRef.current;
          const cur = pageRef.current;
          if (cursorMoved && sel?.provider === "cursor" && cur && !cur.partial) {
            const r = await invoke<MsgPage>("read_chat_page", { provider: "cursor", path: sel.path, before: null, limit: 2000 });
            if (selRef.current?.id === sel.id && r.total !== cur.total) setPage(r);
          }
        }
        if (selRef.current?.provider === "cursor") setLive(Date.now() - cursorChanged.current < 20000);
      } catch {
        /* try again next time */
      } finally {
        busy = false;
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [quietReload]);

  const stamp = useRef("");
  const [live, setLive] = useState(false);
  const selRef = useRef(selected);
  selRef.current = selected;
  useEffect(() => {
    stamp.current = "";
    setLive(false);
    const sel = selected;
    if (!sel || isHandoffOnly(sel.provider) || sel.path.startsWith("archive:")) return;
    let busy = false;
    const id = window.setInterval(async () => {
      const cur = pageRef.current;
      if (busy || !cur || cur.partial || selRef.current?.id !== sel.id) return;
      busy = true;
      try {
        const [size, ms] = await invoke<[number, number]>("chat_stamp", { provider: sel.provider, path: sel.path });
        // Working = the file changed a moment ago, or your message / a tool call is still waiting for the agent to continue.
        const last = cur.messages[cur.messages.length - 1];
        const waiting = !!last && (last.role === "user" || last.kind === "tool");
        const age = Date.now() - ms;
        setLive(age < 20000 || (waiting && age < 120000));
        const st = `${size}:${ms}`;
        if (!stamp.current) {
          stamp.current = st;
          return;
        }
        if (st === stamp.current) return;
        stamp.current = st;
        // Native history updates tool items in place as well as appending items.
        if (sel.path.startsWith("codex-db:")) {
          const r = await invoke<MsgPage>("read_chat_page", { provider: sel.provider, path: sel.path, before: null, limit: 2000 });
          if (selRef.current?.path !== sel.path || selRef.current?.provider !== sel.provider) return;
          if (r.total < cur.total || r.start > cur.total) { setPage(r); return; }
          const updates = new Map(r.messages.filter(m => m.id).map(m => [m.id!, m]));
          setPage(p => {
            if (!p || p.total !== cur.total) return p;
            let changed = false;
            const messages = p.messages.map(m => {
              const next = m.id ? updates.get(m.id) : undefined;
              if (!next || JSON.stringify(next) === JSON.stringify(m)) return m;
              changed = true;
              return next;
            });
            const added = r.messages.slice(Math.max(0, cur.total - r.start));
            return changed || added.length ? { ...p, messages: [...messages, ...added], total: r.total } : p;
          });
          return;
        }
        // Fast path: only the end of the file is read, and what is new is whatever follows the last message already shown.
        const sig = (m: Msg) => `${m.ts}|${m.role}|${m.kind}|${m.text.slice(0, 80)}`;
        const lastShown = cur.messages[cur.messages.length - 1];
        if (lastShown && !isHandoffOnly(sel.provider)) {
          try {
            const tail = await invoke<Msg[]>("read_chat_tail", { provider: sel.provider, path: sel.path, limit: 60 });
            const at = tail.map(sig).lastIndexOf(sig(lastShown));
            if (at >= 0) {
              const add = tail.slice(at + 1);
              if (selRef.current?.id !== sel.id) return;
              if (add.length) setPage((p) => (p && p.total === cur.total ? { ...p, messages: [...p.messages, ...add], total: p.total + add.length } : p));
              return;
            }
          } catch {
            /* fall back to the full read below */
          }
        }
        let r = await invoke<MsgPage>("read_chat_page", { provider: sel.provider, path: sel.path, before: null, limit: 50 });
        const diff = r.total - cur.total;
        if (diff > 50) r = await invoke<MsgPage>("read_chat_page", { provider: sel.provider, path: sel.path, before: null, limit: Math.min(diff, 2000) });
        if (selRef.current?.id !== sel.id) return;
        if (diff <= 0) {
          if (diff < 0) setPage(r);
          return;
        }
        const add = r.messages.slice(-diff);
        setPage((p) => (p && p.total === cur.total ? { ...p, messages: [...p.messages, ...add], total: r.total } : p));
      } catch {
        /* the file may be mid-write; try again next time */
      } finally {
        busy = false;
      }
    }, 600);
    return () => window.clearInterval(id);
  }, [selected?.id, selected?.provider, selected?.path]);

  // Serialize history reads so scroll, timeline and search cannot replace one another's pages.
  const historyQueue = useRef<Promise<void>>(Promise.resolve());
  const earlierBusy = useRef(false);
  const queueHistory = (work: (chat: Chat, valid: () => boolean) => Promise<void>) => {
    const chat = selRef.current;
    const generation = openId.current;
    const valid = () => !!chat && openId.current === generation && selRef.current?.id === chat.id && selRef.current?.provider === chat.provider && selRef.current?.path === chat.path;
    const job = historyQueue.current.then(async () => {
      if (chat && valid()) await work(chat, valid);
    });
    historyQueue.current = job.catch(() => {});
    return job;
  };
  const prependEarlier = (r: MsgPage, from: number) => {
    setPage((cur) => {
      if (!cur || cur.start !== from) return cur;
      return { ...cur, messages: [...r.messages, ...cur.messages], total: Math.max(r.total, cur.total), start: r.start };
    });
  };
  const loadEarlier = async () => {
    if (earlierBusy.current) return;
    earlierBusy.current = true;
    setLoadingEarlier(true);
    try {
      await queueHistory(async (chat, valid) => {
        const cur = pageRef.current;
        if (!cur || cur.partial || cur.start === 0) return;
        const r = await invoke<MsgPage>("read_chat_page", { provider: chat.provider, path: chat.path, before: cur.start, limit: 120 });
        if (valid()) prependEarlier(r, cur.start);
      });
    } catch (e) {
      say(String(e));
    } finally {
      earlierBusy.current = false;
      setLoadingEarlier(false);
    }
  };
  const loadHistoryTo = (target: number, limit: number) => queueHistory(async (chat, valid) => {
    while (valid()) {
      const cur = pageRef.current;
      if (!cur || cur.partial || cur.start === 0) return;
      const oldest = cur.messages.find((m) => m.ts)?.ts;
      if (oldest && Date.parse(oldest) <= target) return;
      const r = await invoke<MsgPage>("read_chat_page", { provider: chat.provider, path: chat.path, before: cur.start, limit });
      if (!valid()) return;
      if (r.start >= cur.start) throw new Error("Earlier messages could not be loaded. Please refresh this chat.");
      prependEarlier(r, cur.start);
    }
  });
  const loadUntil = async (ts: string) => {
    try {
      await loadHistoryTo(Date.parse(ts), 400);
    } catch (e) {
      say(String(e));
    }
  };
  const loadAll = async () => {
    try {
      await loadHistoryTo(Number.NEGATIVE_INFINITY, 2000);
    } catch (e) {
      say(String(e));
    }
  };

  const switchProvider = (p: Tool) => {
    setProvider(p);
    setProject(null);
    setProjectCwd(null);
    setAccounts((a) => ({ ...a, [p]: "all" }));
    setQuery("");
    setSelected(null);
  };

  // Every tool with chats, plus the three main ones. The source list grows with the tools ChatVault supports.
  const toolList: Tool[] = ["all", ...PROVIDERS.filter((p) => CORE_PROVIDERS.includes(p) || (overview[p]?.total ?? 0) > 0 || p === provider)];
  // The navigation uses the short names of the reference mockup: "Hermes", not the full "Hermes Agent".
  const toolName = (p: Tool) => (p === "all" ? "All chats" : p === "hermes" ? "Hermes" : PROVIDER_NAME[p]);
  const toolTotal = (p: Tool) => (p === "all" ? PROVIDERS.reduce((n, x) => n + (overview[x]?.total ?? 0), 0) : overview[p]?.total ?? 0);
  const accountList = provider === "all" ? [] : overview[provider]?.accounts ?? [];

  const lq = q.toLowerCase();
  const pinnedShown = pinned.filter((c) => !lq || named(c).title.toLowerCase().includes(lq) || c.project.toLowerCase().includes(lq));
  const recent = useMemo(() => items.filter((c) => !pinSet.has(chatKey(c))), [items, pinSet]);
  const projectGroups = useMemo(() => groupByProject(recent), [recent]);
  const projectNames = useMemo(() => projectGroups.map(([name]) => name), [projectGroups]);
  const allProjectsClosed = projectNames.length > 0 && projectNames.every((n) => !projectOpen(n));
  const msgs: Msg[] | null = page?.messages ?? null;

  const extras = (c: Chat): ChatAction[] => orderChat(([
    { id: "view", label: "Open in ChatVault", hint: "Reads this chat here.", icon: Eye, group: "Chat", run: async () => open(c) },
    {
      id: "pin",
      label: pinSet.has(chatKey(c)) ? "Unpin" : "Pin to top",
      hint: "Pinned chats stay at the top of the list.",
      icon: pinSet.has(chatKey(c)) ? PinOff : Pin,
      group: "Chat",
      run: async () => togglePin(chatKey(c)),
    },
    {
      id: "delete",
      label: "Delete chat",
      hint: ({ trash: "Moves the chat to the Recycle Bin.", opencode: "Deletes the session from OpenCode. It cannot be restored.", blocked: "Not available: this chat is stored inside another app." } as const)[deleteKind(c)],
      icon: Trash2,
      group: "Chat",
      danger: true,
      muted: deleteKind(c) === "blocked",
      run: async () => requestDelete(c),
    },
    {
      id: "archive",
      label: c.userArchived ? "Unarchive" : "Archive",
      hint: c.userArchived ? "Moves this chat back to your list." : "Moves this chat out of your list into Archived. Nothing is deleted.",
      icon: c.userArchived ? ArchiveRestore : Archive,
      group: "Chat",
      run: async () => archive(c),
    },
    { id: "tags", label: "Tags", hint: "Add your own labels to this chat. Only shown in ChatVault.", icon: Tag, group: "Chat", run: async () => setTagging(c) },
    { id: "rename", label: "Rename", hint: "Give this chat your own name. The original is not changed.", icon: Pencil, group: "Chat", run: async () => setRenaming(c) },
  ] as ChatAction[]));

  const loadTags = useCallback(() => {
    if (!isTauri) return;
    Promise.all((provider === "all" ? PROVIDERS : [provider]).map((p) => invoke<[string, number][]>("all_tags", { provider: p }).catch(() => [] as [string, number][])))
      .then((lists) => {
        const sum = new Map<string, number>();
        lists.flat().forEach(([t, n]) => sum.set(t, (sum.get(t) ?? 0) + n));
        setTagList([...sum].sort((a, b) => a[0].localeCompare(b[0])));
      })
      .catch(() => {});
  }, [provider]);
  useEffect(loadTags, [loadTags, reloadKey]);

  /** Opens the confirm box, or says why this chat cannot be deleted from here. */
  const requestDelete = (c: Chat) => {
    if (deleteKind(c) === "blocked") say(deleteBlockedMessage(PROVIDER_NAME[c.provider]));
    else setDeleting(c);
  };

  const archive = async (c: Chat) => {
    const to = !c.userArchived;
    try {
      await invoke("set_chat_archived", { provider: c.provider, id: c.id, archived: to });
      say(to ? "Moved to Archived" : "Moved back to your list");
      if (selected?.id === c.id && selected.provider === c.provider) setSelected(to && scope !== "archived" ? { ...c, userArchived: to } : { ...c, userArchived: to });
      await quietReload();
    } catch (e) {
      say(String(e));
    }
  };

  /** Right-click on the empty part of the sidebar: how the list is organised, sorted and filtered, plus the usual tools. */
  const listEntries = (): Entry[] => [
    { type: "item", label: "Refresh", icon: <RefreshCw strokeWidth={1.5} />, onSelect: () => void rescan() },
    { type: "sep" },
    { type: "label", label: "Organize" },
    { type: "check", label: "By project", icon: <FolderOpen strokeWidth={1.5} />, checked: organize === "project", onSelect: () => setOrganize("project") },
    { type: "check", label: "In one list", icon: <ListFilter strokeWidth={1.5} />, checked: organize === "list", onSelect: () => setOrganize("list") },
    ...(organize === "project" && projectNames.length > 0
      ? ([{ type: "item", label: allProjectsClosed ? "Expand all projects" : "Collapse all projects", icon: <ChevronsUpDown strokeWidth={1.5} />, onSelect: () => { setProjectsMode(allProjectsClosed ? "open" : "closed"); setProjectExceptions([]); } }] as Entry[])
      : []),
    { type: "sep" },
    { type: "sub", label: "Sort chats by", icon: <ArrowUpDown strokeWidth={1.5} />, entries: Object.entries(SORTS).map(([k, label]) => ({ type: "check", label, checked: sort === k, onSelect: () => setSort(k) }) as Entry) },
    {
      type: "sub",
      label: "Show",
      icon: <Eye strokeWidth={1.5} />,
      entries: [
        ...Object.entries(SCOPES).map(([k, label]) => ({ type: "check", label, checked: scope === k, onSelect: () => setScope(k) }) as Entry),
        ...(tagList.length ? ([{ type: "sep" }] as Entry[]) : []),
        ...tagList.map(([t, n]) => ({ type: "check", label: `${t} (${n})`, icon: <Tag strokeWidth={1.5} />, checked: scope === `tag:${t}`, onSelect: () => setScope(`tag:${t}`) }) as Entry),
      ],
    },
    { type: "item", label: "Reset", icon: <RotateCcw strokeWidth={1.5} />, disabled: sort === "recent" && scope === "all" && organize === "list", onSelect: () => { setSort("recent"); setScope("all"); setOrganize("list"); } },
    { type: "sep" },
    { type: "item", label: "Search all chats", icon: <Search strokeWidth={1.5} />, onSelect: () => openSearch() },
    { type: "item", label: "Sync & backup", icon: <DatabaseBackup strokeWidth={1.5} />, onSelect: () => setSyncOpen(true) },
    { type: "item", label: "Settings", icon: <SettingsIcon strokeWidth={1.5} />, onSelect: () => setSettingsOpen(true) },
    { type: "item", label: "Hide the sidebar", icon: <PanelLeft strokeWidth={1.5} />, onSelect: () => setSidebarOpen(false) },
  ];

  // Stable wrappers around the latest closures, so a card only re-renders when its own data changes.
  const latest = useRef({ extras, open, q });
  latest.current = { extras, open, q };
  const getExtras = useCallback((c: Chat) => latest.current.extras(c), []);
  const openChat = useCallback((c: Chat) => latest.current.open(c, latest.current.q.trim()), []);

  const row = (c: Chat, inProject = false) => (
    <ChatRow
      key={chatKey(c)}
      chat={named(c)}
      selected={selected?.id === c.id && selected.provider === c.provider}
      pinned={pinSet.has(chatKey(c))}
      live={liveKeys.has(chatKey(c))}
      hit={hits?.[c.id]}
      inProject={inProject}
      msgs={selected?.id === c.id ? msgs : null}
      getExtras={getExtras}
      onOpen={openChat}
      toast={say}
    />
  );


  // Search is on every page; Sync & backup and Settings belong to the main page only.
  const searchButton = (
    <Tip label="Search chats and actions (Ctrl+K)">
      <Button variant="outline" size="sm" className="text-muted-foreground" onClick={() => setPaletteOpen(true)}>
        <Search className="size-4" /> Search
        <kbd className="ml-1 rounded border bg-muted px-1 text-[10px]">Ctrl K</kbd>
      </Button>
    </Tip>
  );
  const controls = (
    <>
            {searchButton}
            <Tip label="Back up or restore your chats.">
              <Button size="sm" onClick={() => setSyncOpen(true)}>
                <DatabaseBackup className="size-4" /> Sync &amp; backup
              </Button>
            </Tip>
            <Tip label="Settings: where each tool's chats are read from.">
              <Button size="icon" className="size-8" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
                <SettingsIcon className="size-4" />
              </Button>
            </Tip>
    </>
  );

  const listOrganize = project ? "list" : organize;
  const renderChatList = (list: Chat[]) => {
    if (provider === "imported" && account === "all") {
      return groupByPlatform(list).map(([plat, groupChats]) => (
        <div key={plat} className="space-y-2 pt-3 first:pt-0">
          <div className="flex items-center gap-2 px-1 py-1 text-[12px] font-semibold tracking-wider text-muted-foreground uppercase">
            <span className="shrink-0">
              {sourceGlyph(plat, "size-3.5") ?? <ProviderLogo provider={plat as any} className="size-3.5 grayscale" />}
            </span>
            <span>{accountLabel(plat)}</span>
            <span className="text-[11px] font-normal tabular-nums text-muted-foreground/70">({groupChats.length})</span>
            <div className="h-px flex-1 bg-border/40" />
          </div>
          {groupChats.map((c) => row(c))}
        </div>
      ));
    }
    if (listOrganize === "project") {
      return groupByProject(list).map(([project, list]) => {
        const isOpen = projectOpen(project);
        return (
          <Collapsible
            key={project}
            open={isOpen}
            onOpenChange={(o) => setProjectExceptions((c) => (o === (projectsMode === "open") ? c.filter((x) => x !== project) : c.includes(project) ? c : [...c, project]))}
            className="pt-1"
            onPointerEnter={() => setWarmProjects((w) => (w.has(project) ? w : new Set(w).add(project)))}
          >
            <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-muted-foreground hover:bg-muted/60 hover:text-foreground">
              <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", isOpen && "rotate-90")} />
              <FolderOpen className="size-3.5 shrink-0" strokeWidth={1.5} />
              <span className="min-w-0 flex-1 truncate text-left">{workspaceTitle(project)}</span>
              <Badge variant="secondary" className="h-4 px-1.5 text-[12px] tabular-nums text-muted-foreground">{list.length}</Badge>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-0.5" keepMounted={warmProjects.has(project)}>
              {(isOpen || warmProjects.has(project)) && list.map((c) => row(c, true))}
            </CollapsibleContent>
          </Collapsible>
        );
      });
    }
    return list.map((c) => row(c));
  };



  const importedSubItems: SourceSubItem[] = accountList.map((a) => ({
    id: a.id,
    label: accountLabel(a.id),
    count: a.count,
    active: provider === "imported" && account === a.id,
    logo: sourceGlyph(a.id, "size-3.5") ?? <ProviderLogo provider={a.id as any} className="size-3.5 grayscale" />,
  }));

  const sourceRows: SourceRow[] = [
    { id: "all", label: "All chats", logo: <Layers className="size-5 text-foreground" strokeWidth={1.5} />, count: toolTotal("all"), active: provider === "all" && project === null },
    ...toolList
      .filter((p): p is Provider => p !== "all")
      .map((p) => ({
        id: p,
        label: toolName(p),
        logo: sourceGlyph(p, "size-5") ?? <ProviderLogo provider={p} className="size-5 grayscale" />,
        count: toolTotal(p),
        active: provider === p && project === null,
        subItems: p === "imported" && accountList.length > 1 ? importedSubItems : undefined,
        onSelectSubItem:
          p === "imported"
            ? (subId: string) => {
                setView("chats");
                setProvider("imported");
                setProject(null);
                setProjectCwd(null);
                setAccounts((a) => ({ ...a, imported: subId }));
                setQuery("");
                setSelected(null);
              }
            : undefined,
      })),
  ];

  const activeWorkspace = workspaces.find((w) => w.project === project && w.cwd === projectCwd);
  // One pill per scope. "All" is the amber one; the other two carry an icon and a hairline ring, like the mockup.
  const browserPill = (id: "all" | "starred" | "archived", label: string, icon?: ReactNode) => {
    const active = id === "all" ? !starredOnly && scope !== "archived" : id === "starred" ? starredOnly : !starredOnly && scope === "archived";
    return (
      <button
        type="button"
        onClick={() => {
          if (id === "starred") setStarredOnly(true);
          else {
            setStarredOnly(false);
            setScope(id === "archived" ? "archived" : "all");
          }
        }}
        className={cn(
          "flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors",
          active
            ? "bg-[#f0a83c] text-[#120d04] font-semibold"
            : "border border-border text-muted-foreground hover:bg-muted hover:text-foreground dark:border-white/[0.12] dark:hover:bg-white/[0.06]",
        )}
      >
        {icon}
        {label}
      </button>
    );
  };

  // The status line of the mockup: a green dot and the archive state, nothing else.
  const navStatus = indexing ? (
    <span className="flex items-center gap-2">
      <Loader2 className="size-3.5 animate-spin" />
      <span className="truncate">{indexing.phase} {indexing.done}/{indexing.total}</span>
    </span>
  ) : (
    <span className="flex items-center gap-2">
      <span className="size-2.5 shrink-0 rounded-full bg-[#22c55e]" />
      <span>Archive up to date</span>
    </span>
  );

  return (
    <TooltipProvider delay={200}>
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {splash !== "off" && <Splash leaving={splash === "leaving"} />}
        <TitleBar
          sidebarOpen={sidebarOpen}
          busy={!!indexing}
          dark={dark}
          query={query}
          onQuery={(q) => {
            setQuery(q);
            if (q.trim().length > 0) {
              setProject(null);
              setProjectCwd(null);
              setProvider("all");
              if (view === "dashboard") {
                setView("chats");
              }
            }
          }}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          onRefresh={() => void rescan()}
          onTheme={() => setDark((d) => !d)}
          onHome={() => {
            setView("dashboard");
            setSelected(null);
            setSearchAll(false);
            setProject(null);
            setProjectCwd(null);
          }}
          onSearch={(q) => openSearch(q)}
          onOpenPalette={() => setPaletteOpen(true)}
          onSettings={() => setSettingsOpen(true)}
        />
        <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Nav column: workspaces, sources, archive status */}
        <aside className={cn("flex shrink-0 flex-col overflow-hidden border-r border-border bg-surface-nav transition-[width] duration-300 ease-in-out", sidebarOpen ? "w-[301px]" : "w-0 border-r-0")}>
          <div className={cn("flex min-h-0 w-[301px] flex-1 flex-col transition-opacity duration-200", sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0")}>
            <NavSidebar
              isDashboard={view === "dashboard"}
              onSelectDashboard={() => {
                setView("dashboard");
                setSelected(null);
                setProject(null);
                setProjectCwd(null);
              }}
              workspaces={workspaces}
              loadingWorkspaces={loadingWorkspaces}
              activeProject={project}
              activeCwd={projectCwd}
              onSelectProject={(w) => {
                setView("chats");
                setProject(w?.project ?? null);
                setProjectCwd(w?.cwd ?? null);
                if (w) setProvider("all");
              }}
              sources={sourceRows}
              onSelectSource={(id) => {
                setView("chats");
                switchProvider(id as Tool);
              }}
              status={navStatus}
            />
          </div>
        </aside>

        {/* Conversation browser */}
        {view === "chats" && (
        <section className="flex w-[390px] shrink-0 flex-col overflow-hidden border-r border-border bg-surface-browser">
          <div className="shrink-0 px-4 pb-3 pt-3.5">
            <div className="flex items-center gap-2.5">
              <FolderOpen className="size-[22px] shrink-0 text-[#f0a83c]" strokeWidth={1.75} />
              <h2 className="min-w-0 flex-1 truncate font-sans text-[20px] font-semibold leading-tight text-foreground" title={project ?? undefined}>
                {project ? workspaceTitle(project) : (provider === "all" ? "All conversations" : PROVIDER_NAME[provider])}
              </h2>
              <FiltersMenu
                sort={sort}
                scope={scope}
                tags={tagList}
                onSort={setSort}
                onScope={setScope}
                onReset={() => {
                  setSort("recent");
                  setScope("all");
                }}
              />
            </div>
            <p className="mt-1 truncate text-[13px] text-muted-foreground" title={activeWorkspace?.cwd}>
              {activeWorkspace?.cwd ?? (provider === "imported" ? "~/Documents/ChatVault Import" : provider === "all" ? "Every source" : PROVIDER_NAME[provider])}
            </p>
            <div className="mt-3 flex items-center gap-2">
              {browserPill("all", "All")}
              {browserPill("starred", "Starred", <Star className="size-3.5 shrink-0" strokeWidth={1.75} />)}
              {browserPill("archived", "Archived", <Archive className="size-3.5 shrink-0" strokeWidth={1.75} />)}
            </div>
          </div>

          <ContextArea className="flex min-h-0 flex-1 flex-col" entries={() => listEntries()} onError={(e) => say(String(e))}>
          <FadedScroll className="flex-1" fadeTop={false}>
            <div className="space-y-2 p-2">
              {starredOnly ? (
                pinnedShown.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 p-8 text-center">
                    <Star className="size-8 text-muted-foreground" strokeWidth={1.25} />
                    <p className="text-sm font-medium">No Starred Chats</p>
                    <p className="text-xs text-muted-foreground">Star a chat to find it here.</p>
                  </div>
                ) : (
                  pinnedShown.map((c) => row(c))
                )
              ) : (
                <>
                  {indexing && items.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 p-8 text-center text-muted-foreground">
                      <Loader2 className="size-6 animate-spin text-[#f0a83c]" />
                      <p className="text-sm font-medium text-foreground">Reading conversations…</p>
                      <p className="text-xs text-muted-foreground">
                        {indexing.phase} ({indexing.done}/{indexing.total})
                      </p>
                    </div>
                  ) : (loadingList || (searching && items.length === 0)) && items.length === 0 ? (
                    <SidebarSkeleton rows={searching ? 5 : 8} />
                  ) : !loadingList && !indexing && !searching && !error && recent.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 p-8 text-center">
                      <Search className="size-8 text-muted-foreground" strokeWidth={1.25} />
                      <p className="text-sm font-medium">No Chats Found</p>
                      <p className="text-xs text-muted-foreground">Try a different word or account.</p>
                    </div>
                  ) : null}
                  {renderChatList(recent)}
                </>
              )}
              {hasMore && !starredOnly && (
                <div ref={sentinelRef}>
                  <SidebarSkeleton rows={3} />
                </div>
              )}
            </div>
          </FadedScroll>
          </ContextArea>

          <div className="flex h-12 shrink-0 items-center border-t border-border px-4 text-[13px] tabular-nums text-muted-foreground">
            {(starredOnly ? pinnedShown.length : total).toLocaleString()} conversations
          </div>
        </section>
        )}

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Suspense fallback={<MessagesSkeleton />}>
          {searchAll ? (
            <GlobalSearch
              key={searchSeed}
              initial={searchSeed}
              titleOf={(c) => named(c).title}
              onClose={() => setSearchAll(false)}
              onOpenChat={(c, term) => {
                setSearchAll(false);
                setQuery("");
                setView("chats");
                if (c.provider !== provider) setProvider(c.provider);
                open(c, term);
              }}
            />
          ) : view === "dashboard" ? (
            <OverviewPage
              actions={controls}
              indexing={indexing}
              userName={accountInfo.find((a) => a.cliCurrent)?.name ?? undefined}
              overview={overview}
              accountCount={new Set([...(overview.claude?.accounts ?? []), ...(overview.codex?.accounts ?? [])].map((a) => a.id)).size}
              reloadKey={reloadKey}
              titleOf={(c) => named(c).title}
              onOpenChat={(c) => {
                setQuery("");
                setView("chats");
                if (c.provider !== provider) setProvider(c.provider);
                open(c);
              }}
              onSync={() => setSyncOpen(true)}
              onSearch={() => openSearch()}
              dark={dark}
              onTheme={() => setDark((d) => !d)}
              onRefresh={() => void rescan()}
              onShowTool={(p) => {
                setView("chats");
                switchProvider(p);
              }}
              onOpenBackup={() => void invoke("open_backup_folder").catch((e) => say(String(e)))}
              rowEntries={(c) => chatEntries(named(c), say, null, extras(c))}
              workspaces={workspaces}
              onSelectProject={(w) => {
                setView("chats");
                setProject(w?.project ?? null);
                setProjectCwd(w?.cwd ?? null);
                if (w) setProvider("all");
              }}
              pinned={pinned}
            />
          ) : selected ? (
            <ChatView
              key={chatKey(selected)}
              chat={named(selected)}
              initialQuery={searchTarget}
              page={page}
              loadingEarlier={loadingEarlier}
              live={live}
              outline={outline}
              onLoadUntil={loadUntil}
              onLoadEarlier={loadEarlier}
              onLoadAll={loadAll}
              showSteps={showSteps}
              onToggleSteps={() => setShowSteps((s) => !s)}
              headerOpen={headerOpen}
              onToggleHeader={() => setHeaderOpen((o) => !o)}
              pinned={pinSet.has(chatKey(selected))}
              onTogglePin={() => togglePin(chatKey(selected))}
              onArchive={() => void archive(selected)}
              onRename={() => setRenaming(selected)}
              onDelete={() => requestDelete(selected)}
              onSearchAll={(q) => openSearch(q)}
              onRefresh={() => { void rescan(); open(selected); }}
              onOverview={() => {
                setView("dashboard");
                setSelected(null);
              }}
              toast={say}
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center text-center p-8 text-muted-foreground select-none">
              <VaultLogo className="size-16 mb-4 opacity-25" />
              <p className="text-lg font-medium text-foreground/80">No conversation selected</p>
              <p className="text-sm mt-1 max-w-sm text-muted-foreground">Select a conversation from the list to view its messages, export it, or continue the thread.</p>
            </div>
          )}
          </Suspense>
        </main>
        </div>
        </div>

        <Suspense fallback={null}>
        {paletteOpen && <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          provider={provider === "all" ? "claude" : provider}
          pinned={pinned}
          titleOf={(c) => named(c).title}
          onOpenChat={(c, term) => {
            setPaletteOpen(false);
            setQuery("");
            setView("chats");
            if (c.provider !== provider) setProvider(c.provider);
            open(c, term);
          }}
          actions={[
            { id: "overview", label: "Back to Home", icon: <LayoutDashboard className="size-4" />, run: () => { setView("dashboard"); setSelected(null); } },
            { id: "claude", label: "Show Claude chats", icon: <ProviderLogo provider="claude" className="size-4" />, run: () => { setView("chats"); switchProvider("claude"); } },
            { id: "codex", label: "Show Codex chats", icon: <ProviderLogo provider="codex" className="size-4" />, run: () => { setView("chats"); switchProvider("codex"); } },
            { id: "grok", label: "Show Grok chats", icon: <ProviderLogo provider="grok" className="size-4" />, run: () => { setView("chats"); switchProvider("grok"); } },
            { id: "sync", label: "Sync & backup", icon: <DatabaseBackup className="size-4" />, run: () => setSyncOpen(true) },
            { id: "settings", label: "Settings", icon: <SettingsIcon className="size-4" />, run: () => setSettingsOpen(true) },
            { id: "import", label: "Import NousSave chats", icon: <FilePlus2 className="size-4" />, run: () => {
              void (async () => {
                try {
                  const r = await importNousSave(false);
                  if (!r) return;
                  if (r.added === 0 && r.failed.length) notifyError(describeImport(r));
                  else notify(describeImport(r));
                  if (r.added) {
                    setProvider("imported");
                    await rescan();
                  }
                } catch (e) {
                  notifyError(e);
                }
              })();
            } },
            { id: "refresh", label: "Scan this PC for new chats", icon: <RefreshCw className="size-4" />, run: () => void rescan() },
            { id: "theme", label: dark ? "Light theme" : "Dark theme", icon: dark ? <Sun className="size-4" /> : <Moon className="size-4" />, run: () => setDark((d) => !d) },
          ]}
        />}
        </Suspense>
        <Suspense fallback={null}>
          {syncOpen && <SyncDialog open={syncOpen} onOpenChange={setSyncOpen} onChanged={rescan} onMove={setMovePending} toast={say} />}
          {movePending && (
            <MoveBackupDialog
              check={movePending}
              toast={say}
              onClose={() => {
                setMovePending(null);
                setSyncOpen(true);
              }}
              onDone={() => {
                setMovePending(null);
                setSyncOpen(true);
                void rescan();
              }}
            />
          )}
          <RenameAccountDialog
            account={renamingAccount ? { id: renamingAccount, original: originalAccountLabel(renamingAccount), custom: accountNames[renamingAccount] ?? "" } : null}
            onSave={renameAccount}
            onClose={() => setRenamingAccount(null)}
          />
          {settingsOpen && (
            <SettingsDialog
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              dark={dark}
              onSetDark={setDark}
              onToolsChanged={async () => {
                const off = await applyOff();
                if (provider !== "all" && off.includes(provider)) setProvider("all");
                void rescan();
              }}
            />
          )}
        </Suspense>
        <DeleteDialog
          chat={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={async (c) => {
            const kind = deleteKind(c);
            await invoke("delete_chat", { path: c.path });
            if (selected && selected.id === c.id && selected.provider === c.provider) setSelected(null);
            setDeleting(null);
            say(kind === "opencode" ? "Deleted from OpenCode" : "Moved to the Recycle Bin");
            setReloadKey((n) => n + 1);
          }}
        />
        <Suspense fallback={null}>
        {tagging && <TagsDialog
          chat={tagging}
          suggestions={tagList.map(([t]) => t)}
          onClose={() => setTagging(null)}
          onSaved={() => {
            loadTags();
            void quietReload();
          }}
        />}
        </Suspense>
        <RenameDialog
          chat={renaming}
          current={renaming ? (names[chatKey(renaming)] ?? "") : ""}
          onClose={() => setRenaming(null)}
          onSave={(name) => {
            if (renaming) rename(chatKey(renaming), name);
            setRenaming(null);
          }}
        />
        <AppToaster />
      </div>
    </TooltipProvider>
  );
}

const groupByProject = (list: Chat[]) => {
  const map = new Map<string, Chat[]>();
  list.forEach((c) => {
    const g = map.get(c.project);
    if (g) g.push(c);
    else map.set(c.project, [c]);
  });
  const entries = [...map.entries()];
  if (list.length > 0 && list.every((c) => c.provider === "imported")) {
    entries.sort((a, b) => a[0].localeCompare(b[0]));
  }
  return entries;
};

const orderChat = (list: ChatAction[]) => [...list.filter((a) => !a.danger), ...list.filter((a) => a.danger)];

const SORTS: Record<string, string> = { recent: "Most recent", oldest: "Oldest first", title: "Title A to Z", size: "Largest first" };
const SCOPES: Record<string, string> = { all: "All", live: "On this PC", backup: "Backup only", archived: "Archived" };

function FiltersMenu({
  sort,
  scope,
  tags,
  onSort,
  onScope,
  onReset,
}: {
  tags: [string, number][];
  sort: string;
  scope: string;
  onSort: (s: string) => void;
  onScope: (s: string) => void;
  onReset: () => void;
}) {
  const isFiltered = sort !== "recent" || scope !== "all";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Filters" className="size-7 shrink-0 text-muted-foreground hover:text-foreground" />}>
        <MoreHorizontal className="size-4.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 rounded-xl border border-border bg-popover p-1 font-sans text-[13px] text-popover-foreground shadow-2xl dark:border-white/10 dark:bg-[#1a1c1e] dark:text-foreground">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <ArrowUpDown className="size-4 text-muted-foreground" strokeWidth={1.5} /> Sort by
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44 rounded-xl border border-border bg-popover p-1 font-sans text-[13px] text-popover-foreground shadow-2xl dark:border-white/10 dark:bg-[#1a1c1e] dark:text-foreground">
            <DropdownMenuRadioGroup value={sort} onValueChange={onSort}>
              {Object.entries(SORTS).map(([k, label]) => (
                <DropdownMenuRadioItem key={k} value={k}>
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <Eye className="size-4 text-muted-foreground" strokeWidth={1.5} /> Filter
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-44 rounded-xl border border-border bg-popover p-1 font-sans text-[13px] text-popover-foreground shadow-2xl dark:border-white/10 dark:bg-[#1a1c1e] dark:text-foreground">
            <DropdownMenuRadioGroup value={scope} onValueChange={onScope}>
              {Object.entries(SCOPES).map(([k, label]) => (
                <DropdownMenuRadioItem key={k} value={k}>
                  {label}
                </DropdownMenuRadioItem>
              ))}
              {tags.length > 0 && <DropdownMenuSeparator className="bg-border dark:bg-white/10" />}
              {tags.map(([t, n]) => (
                <DropdownMenuRadioItem key={t} value={`tag:${t}`}>
                  <Tag className="size-3.5 text-muted-foreground" strokeWidth={1.5} /> {t} <span className="ml-auto text-xs text-muted-foreground">{n}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {isFiltered && (
          <>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuItem onClick={onReset} className="gap-2 text-muted-foreground hover:text-foreground">
              <RotateCcw className="size-3.5" strokeWidth={1.5} /> Reset filters
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const ChatRow = memo(function ChatRow({
  chat,
  selected,
  pinned,
  live,
  hit,
  inProject,
  msgs,
  getExtras,
  onOpen,
  toast,
}: {
  chat: Chat;
  selected: boolean;
  pinned: boolean;
  live?: boolean;
  hit?: string;
  inProject?: boolean;
  msgs: Msg[] | null;
  getExtras: (c: Chat) => ChatAction[];
  onOpen: (c: Chat) => void;
  toast: (m: string) => void;
}) {
  return (
    <ChatCard
      chat={chat}
      selected={selected}
      pinned={pinned}
      onUnpin={() => {
        const action = getExtras(chat).find((a) => a.id === "pin");
        if (action) void runAction(action.label, action.run);
      }}
      live={live}
      hit={hit}
      inProject={inProject}
      onOpen={() => onOpen(chat)}
      menu={<ChatMenu chat={chat} toast={toast} msgs={msgs} getExtras={() => getExtras(chat)} />}
      entries={() => chatEntries(chat, toast, msgs, getExtras(chat))}
      onError={(e) => toast(String(e))}
    />
  );
});

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children as ReactElement} />
      <TooltipContent className="max-w-xs">{label}</TooltipContent>
    </Tooltip>
  );
}

function DeleteDialog({ chat, onClose, onConfirm }: { chat: Chat | null; onClose: () => void; onConfirm: (c: Chat) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const tool = chat ? PROVIDER_NAME[chat.provider] : "";
  return (
    <AlertDialog open={!!chat} onOpenChange={(o) => !o && !busy && onClose()}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Trash2 className="size-4 text-destructive" strokeWidth={1.5} />
            </div>
            <div className="min-w-0 space-y-1">
              <AlertDialogTitle className="text-base font-medium">Delete this chat?</AlertDialogTitle>
              <AlertDialogDescription>
                {!chat
                  ? null
                  : deleteKind(chat) === "opencode"
                    ? `“${chat.title}” is deleted from ${tool} for good. It cannot be restored from the Recycle Bin. A copy in your backup folder, if you made one, is kept.`
                    : `“${chat.title}” moves to the Recycle Bin and disappears from ${tool}. You can restore it from the Recycle Bin.${chat.backup ? " This is a backup copy, so nothing else is removed." : " A copy in your backup folder is kept."}`}
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter className="grid grid-cols-2 gap-2 sm:flex">
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={async (e) => {
              e.preventDefault();
              if (!chat) return;
              setBusy(true);
              try {
                await onConfirm(chat);
              } catch (err) {
                notify(String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RenameDialog({ chat, current, onClose, onSave }: { chat: Chat | null; current: string; onClose: () => void; onSave: (name: string) => void }) {
  const [value, setValue] = useState("");
  useEffect(() => setValue(current || chat?.title || ""), [chat, current]);
  return (
    <Dialog open={!!chat} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Pencil className="size-4 text-muted-foreground" strokeWidth={1.5} />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-medium">Rename chat</DialogTitle>
              <DialogDescription>Only shown in ChatVault.</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(value);
          }}
          className="space-y-4"
        >
          <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="Chat name" maxLength={120} />
          <DialogFooter className="grid grid-cols-2 gap-2 sm:flex">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Continue in Gemini CLI" / "Copy Codex command" under a heading that already says it: just "Gemini CLI", "Codex". */
const shortName = (a: ChatAction) => a.label.replace(/^Continue in /, "").replace(/^Copy /, "").replace(/ command$/, "");
const isToolCommand = (a: ChatAction) => a.id.startsWith("copy-") && !COPY_CONTENT_IDS.includes(a.id);

/**
 * The right-click menu of a chat (sidebar and overview). Ordered by what people do most: pick the chat up again, open it,
 * keep it tidy, move it to another tool, take a copy of it, find its folder, and last of all delete it.
 */
function chatEntries(chat: Chat, toast: (m: string) => void, msgs: Msg[] | null, extras: ChatAction[]): Entry[] {
  const all = [...extras, ...chatActions(chat, toast, msgs)];
  const byId = (id: string) => all.find((a) => a.id === id);
  const item = (a: ChatAction | undefined, label?: string): Entry[] => {
    if (!a) return [];
    return [{ type: "item", label: label ?? a.label, icon: <ActionIcon action={a} className="size-4" />, onSelect: () => runAction(a.label, a.run), danger: a.danger && !a.muted, muted: a.muted }];
  };
  const handoff = continueTargets(all);
  const commands = all.filter(isToolCommand);
  const more: Entry[] = [
    ...item(byId("copy-md"), "Markdown"),
    ...item(byId("copy-id"), "Chat ID"),
    ...item(byId("fork")),
    ...(commands.length ? ([{ type: "sep" }, { type: "label", label: "Copy the command to start" }, ...commands.flatMap((a) => item(a, shortName(a)))] as Entry[]) : []),
  ];
  const saveItems = all.filter((a) => a.group === "Save").flatMap((a) => item(a));
  // The same order as the "…" menu on the card and the right-click menu inside a chat.
  return [
    ...item(byId("view")),
    ...(handoff.length ? ([{ type: "sub", label: "Continue this chat in", icon: <ArrowRightLeft strokeWidth={1.5} />, entries: handoff.flatMap((a) => item(a, shortName(a))) }] as Entry[]) : []),
    { type: "sep" },
    ...item(byId("copy-prompt")),
    ...item(byId("copy-path")),
    ...(more.length ? ([{ type: "sub", label: "More copy options", icon: <Copy strokeWidth={1.5} />, entries: more }] as Entry[]) : []),
    ...(saveItems.length ? ([{ type: "sub", label: "Save as", icon: <Save strokeWidth={1.5} />, entries: saveItems }] as Entry[]) : []),
    { type: "sep" },
    ...["pin", "rename", "tags", "archive"].flatMap((id) => item(byId(id))),
    { type: "sep" },
    ...item(byId("folder")),
    { type: "sep" },
    ...item(byId("delete")),
  ];
}

const QUICK = ["continue-claude", "continue-codex", "fork", "folder", "copy-id"];

function ChatMenu({ chat, toast, msgs, getExtras }: { chat: Chat; toast: (m: string) => void; msgs: Msg[] | null; getExtras: () => ChatAction[] }) {
  const [open, setOpen] = useState(false);
  // Built only while the menu is open: the closed button needs none of it.
  const actions = !open ? [] : [...getExtras(), ...chatActions(chat, toast, msgs).filter((a) => QUICK.includes(a.id) || a.id.startsWith("continue-") || a.id.startsWith("copy-") || a.group === "Save")];
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  const byId = (id: string) => actions.find((a) => a.id === id);
  // Grouped by what you want to do: open it, continue it, copy it for an AI, save it, tidy it, find its folder, delete it.
  const organise = ["pin", "rename", "tags", "archive"].map(byId).filter(Boolean) as ChatAction[];
  const view = ["view"].map(byId).filter(Boolean) as ChatAction[];
  const others = continueTargets(actions);
  const files = ["folder"].map(byId).filter(Boolean) as ChatAction[];
  const commands = actions.filter(isToolCommand);
  const copyIds = ["copy-md", "copy-id", "fork"].map(byId).filter(Boolean) as ChatAction[];
  // The two copies people reach for most sit on the menu itself, not inside "Copy".
  const quickCopies = ["copy-prompt", "copy-path"].map(byId).filter(Boolean) as ChatAction[];
  const saves = actions.filter((a) => a.group === "Save");
  // Rows that open a panel to the side, so the list itself stays short.
  const folds: { label: string; icon: LucideIcon; heading: string; items: ChatAction[]; sub?: { heading: string; items: ChatAction[] } }[] = [
    { label: "Continue this chat in", icon: ArrowRightLeft, heading: "Continue this chat in", items: others },
    { label: "More copy options", icon: Copy, heading: "Copy this chat", items: copyIds, sub: { heading: "Copy the command to start", items: commands } },
    { label: "Save as", icon: Save, heading: "Save this chat", items: saves },
  ].filter((f) => f.items.length || f.sub?.items.length);
  const sections: { items: ChatAction[]; folds?: string[] }[] = [
    { items: view },
    { items: [], folds: ["Continue this chat in"] },
    { items: quickCopies, folds: ["More copy options"] },
    { items: [], folds: ["Save as"] },
    { items: organise },
    { items: files },
    { items: actions.filter((a) => a.danger) },
  ];
  // Short names inside "More copy options": the panel title already says these are copies.
  const SHORT_COPY: Record<string, string> = { "copy-md": "Markdown", "copy-id": "Chat ID" };
  const renderItem = (a: ChatAction, short = false) => {
    return (
      <button
        key={a.id}
        className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-60", a.danger && !a.muted && "text-destructive hover:bg-destructive/10", a.muted && "opacity-50")}
        onClick={() => {
          setOpen(false);
          void runAction(a.label, a.run);
        }}      >
        <ActionIcon action={a} className={cn("size-4", !a.logo && (a.danger && !a.muted ? "text-destructive" : "text-muted-foreground"))} />
        {short ? shortName(a) : SHORT_COPY[a.id] ?? a.label}
      </button>
    );
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Chat actions"
            className={cn(
              "-my-1 size-7 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
              open && "opacity-100",
            )}
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={8} className="w-64 gap-0 p-1" onClick={(e) => e.stopPropagation()}>
        {sections
          .filter((sec) => sec.items.length || folds.some((f) => sec.folds?.includes(f.label)))
          .map((sec, i) => (
            <div key={i}>
              {i > 0 && <Separator className="my-1" />}
              {sec.items.map((a) => renderItem(a))}
              {folds
                .filter((f) => sec.folds?.includes(f.label))
                .map((f) => (
                  <Popover key={f.label}>
                    <PopoverTrigger
                      openOnHover
                      delay={60}
                      render={<button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted data-popup-open:bg-muted" />}
                    >
                      <f.icon className="size-4 text-muted-foreground" strokeWidth={1.5} />
                      <span className="flex-1">{f.label}</span>
                      <ChevronRight className="size-4 text-muted-foreground" strokeWidth={1.5} />
                    </PopoverTrigger>
                    <PopoverContent side="right" align="start" sideOffset={6} className="w-52 gap-0 p-1" onClick={(e) => e.stopPropagation()}>
                      <p className="px-2 pb-0.5 pt-1.5 text-xs text-muted-foreground">{f.heading}</p>
                      {f.items.map((a) => renderItem(a, f.label === "Continue this chat in"))}
                      {f.sub && f.sub.items.length > 0 && (
                        <>
                          <Separator className="my-1" />
                          <p className="px-2 pb-0.5 pt-1.5 text-xs text-muted-foreground">{f.sub.heading}</p>
                          {f.sub.items.map((a) => renderItem(a, true))}
                        </>
                      )}
                    </PopoverContent>
                  </Popover>
                ))}
            </div>
          ))}
      </PopoverContent>
    </Popover>
  );
}
