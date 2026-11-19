import { useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { FadedScroll } from "@/faded-scroll";
import { Activity, ArrowRight, DatabaseBackup, FolderOpen, HardDrive, Layers, RefreshCw, ShieldCheck, Star } from "lucide-react";
import { ContextArea, type Entry } from "@/context-area";
import { openUrl } from "@tauri-apps/plugin-opener";
import { REPO_URL } from "@/made-with";
import { ProviderLogo } from "@/claude-logo";
import { sourceGlyph } from "@/source-icons";
import { CORE_PROVIDERS, PROVIDERS, PROVIDER_SHORT, fmtSize, type Chat, type Provider } from "@/chat-actions";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { WorkspaceRow } from "@/nav-sidebar";
import { AboutDialog } from "@/about-dialog";

type Overview = { total: number; accounts: { id: string; count: number }[]; latestMs: number | null };
type Backup = { path: string; exists: boolean; files: number; bytes: number; lastSyncMs: number | null };
type Stats = {
  daily: { day: string; provider: Provider; count: number }[];
  projects: { name: string; count: number; claude: number; codex: number; cursor: number; lastMs: number }[];
  sizeClaude: number;
  sizeCodex: number;
  sizes?: Record<string, number>;
};

const DAYS = 14;

function when(ms: number) {
  const d = new Date(ms);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function niceTitle(title: string) {
  if (!/^Read the file\s/i.test(title) || !/handoffs?/i.test(title)) return title;
  const file = /handoffs?[\/]+([^\/\s]+)/i.exec(title)?.[1] ?? "";
  const name = file.replace(/\.(md|txt)$/i, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  return name ? `Continued from handoff: ${name}` : "Continued from a handoff file";
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const chartConfig = {
  activity: { label: "Conversations", color: "#f0a83c" },
} satisfies ChartConfig;

export function OverviewPage({
  overview,
  accountCount,
  reloadKey,
  titleOf,
  onOpenChat,
  onSync,
  onSearch,
  indexing,
  onRefresh,
  onOpenBackup,
  workspaces,
  onSelectProject,
  pinned,
}: {
  overview: Record<Provider, Overview | null>;
  accountCount: number;
  reloadKey: number;
  titleOf: (c: Chat) => string;
  onOpenChat: (c: Chat) => void;
  onSync: () => void;
  onSearch: () => void;
  actions?: ReactNode;
  indexing?: { done: number; total: number } | null;
  userName?: string;
  dark?: boolean;
  onShowTool?: (p: Provider) => void;
  onRefresh?: () => void;
  onTheme?: () => void;
  onOpenBackup?: () => void;
  rowEntries?: (c: Chat) => Entry[];
  workspaces?: WorkspaceRow[];
  onSelectProject?: (w: WorkspaceRow | null) => void;
  pinned?: Chat[];
}) {
  const [recent, setRecent] = useState<Chat[] | null>(null);
  const [backup, setBackup] = useState<Backup | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [activeTab, setActiveTab] = useState<"recent" | "starred">("recent");
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => {
    let stale = false;
    invoke<{ items: Chat[] }>("query_chats", { provider: "all", account: "all", q: "", offset: 0, limit: 6, sort: "recent", scope: "all" })
      .then((r) => !stale && setRecent(r.items))
      .catch(() => !stale && setRecent([]));
    invoke<Backup>("backup_status").then((b) => !stale && setBackup(b)).catch(() => {});
    invoke<Stats>("overview_stats", { days: DAYS }).then((s) => !stale && setStats(s)).catch(() => {});
    return () => {
      stale = true;
    };
  }, [reloadKey]);

  const total = PROVIDERS.reduce((n, p) => n + (overview[p]?.total ?? 0), 0);

  // Daily totals for a warm unified chart
  const days = useMemo(() => {
    const map = new Map<string, number>();
    stats?.daily.forEach((d) => {
      map.set(d.day, (map.get(d.day) ?? 0) + d.count);
    });
    return Array.from({ length: DAYS }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (DAYS - 1 - i));
      const k = dayKey(date);
      return {
        date,
        label: date.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        activity: map.get(k) ?? 0,
      };
    });
  }, [stats]);

  const shownTools = PROVIDERS.filter((p) => CORE_PROVIDERS.includes(p) || (overview[p]?.total ?? 0) > 0);
  const week = days.slice(-7).reduce((n, d) => n + d.activity, 0);
  const totalDiskBytes = stats ? PROVIDERS.reduce((n, p) => n + (stats.sizes?.[p] ?? 0), 0) : 0;

  const displayedChats = activeTab === "recent" ? recent : (pinned ?? []);

  return (
    <ContextArea
      className="flex min-h-0 flex-1 flex-col bg-background dark:bg-[#121315]"
      entries={() => [
        ...(onRefresh ? ([{ type: "item", label: "Refresh", icon: <RefreshCw strokeWidth={1.5} />, onSelect: onRefresh }, { type: "sep" }] as Entry[]) : []),
        { type: "item", label: "Sync & backup", icon: <DatabaseBackup strokeWidth={1.5} />, onSelect: onSync },
        { type: "item", label: "The project on GitHub", icon: <FolderOpen strokeWidth={1.5} />, onSelect: () => void openUrl(REPO_URL) },
      ]}
    >
      <FadedScroll className="flex-1">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-8 py-8">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border dark:border-white/[0.08] pb-6">
            <div>
              <h1 className="font-sans text-[28px] font-bold tracking-tight text-foreground">
                Dashboard
              </h1>
              <p className="mt-1 text-[14px] text-muted-foreground">
                {indexing
                  ? `Reading conversations… (${indexing.done}/${indexing.total})`
                  : `${total.toLocaleString()} conversations indexed across ${shownTools.length} sources · ${week} active this week`}
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              {onRefresh && (
                <button
                  type="button"
                  onClick={onRefresh}
                  className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-muted dark:border-white/[0.1] dark:bg-[#1a1c1e] dark:hover:bg-[#26282c]"
                >
                  <RefreshCw className="size-3.5 text-muted-foreground" />
                  Refresh
                </button>
              )}
              <button
                type="button"
                onClick={onSync}
                className="flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-[#f0a83c] px-4 text-[13px] font-semibold text-[#120d04] transition-colors hover:bg-[#f5b85a]"
              >
                <DatabaseBackup className="size-4" />
                Sync &amp; Backup
              </button>
            </div>
          </div>

          {/* Key Metric KPI Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-xs transition-colors hover:border-border/80 dark:border-white/[0.08] dark:bg-[#16181a] dark:hover:border-white/[0.15]">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-muted-foreground">Total Conversations</span>
                <span className="flex size-7 items-center justify-center rounded-lg bg-amber-100 text-amber-900 dark:bg-[#362c21] dark:text-[#f0a83c]">
                  <Layers className="size-4" strokeWidth={1.75} />
                </span>
              </div>
              <div className="mt-4">
                <p className="font-sans text-[26px] font-bold tabular-nums text-foreground">{total.toLocaleString()}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">Local &amp; imported history</p>
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-xs transition-colors hover:border-border/80 dark:border-white/[0.08] dark:bg-[#16181a] dark:hover:border-white/[0.15]">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-muted-foreground">Active This Week</span>
                <span className="flex size-7 items-center justify-center rounded-lg bg-amber-100 text-amber-900 dark:bg-[#362c21] dark:text-[#f0a83c]">
                  <Activity className="size-4" strokeWidth={1.75} />
                </span>
              </div>
              <div className="mt-4">
                <p className="font-sans text-[26px] font-bold tabular-nums text-amber-900 dark:text-[#f0a83c]">{week.toLocaleString()}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">In the last 7 days</p>
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-xs transition-colors hover:border-border/80 dark:border-white/[0.08] dark:bg-[#16181a] dark:hover:border-white/[0.15]">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-muted-foreground">Active Sources</span>
                <span className="flex size-7 items-center justify-center rounded-lg bg-amber-100 text-amber-900 dark:bg-[#362c21] dark:text-[#f0a83c]">
                  <FolderOpen className="size-4" strokeWidth={1.75} />
                </span>
              </div>
              <div className="mt-4">
                <p className="font-sans text-[26px] font-bold tabular-nums text-foreground">{shownTools.length}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">{accountCount} connected accounts</p>
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-border bg-card p-5 shadow-xs transition-colors hover:border-border/80 dark:border-white/[0.08] dark:bg-[#16181a] dark:hover:border-white/[0.15]">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-muted-foreground">Local Storage</span>
                <span className="flex size-7 items-center justify-center rounded-lg bg-amber-100 text-amber-900 dark:bg-[#362c21] dark:text-[#f0a83c]">
                  <HardDrive className="size-4" strokeWidth={1.75} />
                </span>
              </div>
              <div className="mt-4">
                <p className="font-sans text-[26px] font-bold tabular-nums text-foreground">
                  {stats ? fmtSize(totalDiskBytes) : "—"}
                </p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">Private in ~/.local/share</p>
              </div>
            </div>
          </div>

          {/* Active Workspaces */}
          {workspaces && workspaces.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-[14px] font-semibold tracking-wider text-muted-foreground uppercase">
                  Active Workspaces
                </h2>
                <span className="text-[12px] text-muted-foreground">
                  {workspaces.length} workspaces
                </span>
              </div>
              <div className="flex flex-wrap gap-2.5">
                {workspaces.slice(0, 6).map((w) => (
                  <button
                    key={`${w.project}-${w.cwd}`}
                    type="button"
                    onClick={() => onSelectProject?.(w)}
                    title={w.cwd}
                    className="group flex cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-2.5 text-[14px] font-medium text-foreground shadow-xs transition-all hover:border-amber-500/50 hover:bg-amber-50/60 dark:border-white/[0.08] dark:bg-[#16181a] dark:hover:border-[#f0a83c]/50 dark:hover:bg-[#1e1b17]"
                  >
                    <FolderOpen className="size-4 text-[#f0a83c]" strokeWidth={1.75} />
                    <span className="font-semibold transition-colors group-hover:text-amber-900 dark:group-hover:text-[#f0a83c]">{w.project}</span>
                    <span className="rounded-full bg-muted dark:bg-white/[0.06] px-2 py-0.5 text-[12px] font-medium tabular-nums text-muted-foreground transition-colors group-hover:bg-amber-100 group-hover:text-amber-950 dark:group-hover:bg-[#624724] dark:group-hover:text-[#f0c27a]">
                      {w.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Two-Column Layout: Conversations (Left) & Activity + Storage (Right) */}
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            {/* Conversations Column */}
            <div className="space-y-3.5 lg:col-span-7">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/60 dark:border-white/[0.08] dark:bg-[#16181a] p-1">
                  <button
                    type="button"
                    onClick={() => setActiveTab("recent")}
                    className={cn(
                      "flex h-7 cursor-pointer items-center rounded-md px-3 text-[13px] font-medium transition-colors",
                      activeTab === "recent"
                        ? "bg-card text-foreground font-semibold shadow-xs dark:bg-[#362c21] dark:text-[#f0a83c]"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Recent
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("starred")}
                    className={cn(
                      "flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors",
                      activeTab === "starred"
                        ? "bg-card text-foreground font-semibold shadow-xs dark:bg-[#362c21] dark:text-[#f0a83c]"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Star className="size-3" strokeWidth={1.75} />
                    Starred {pinned && pinned.length > 0 ? `(${pinned.length})` : ""}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={onSearch}
                  className="flex cursor-pointer items-center gap-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  Search all <ArrowRight className="size-3.5" />
                </button>
              </div>

              <div className="space-y-3.5">
                {displayedChats === null ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-card dark:border-white/[0.05] dark:bg-[#16181a]" />
                  ))
                ) : displayedChats.length === 0 ? (
                  <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card dark:border-white/[0.08] dark:bg-[#16181a] p-10 text-center text-muted-foreground">
                    <p className="text-sm font-medium text-foreground">
                      {activeTab === "starred" ? "No starred conversations" : "No conversations found"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {activeTab === "starred"
                        ? "Star a conversation in the list to keep it pinned here."
                        : "Start using your AI tools to see conversations here."}
                    </p>
                  </div>
                ) : (
                  displayedChats.map((c) => (
                    <button
                      key={`${c.provider}:${c.id}`}
                      type="button"
                      onClick={() => onOpenChat(c)}
                      className="group flex w-full cursor-pointer flex-col rounded-xl border border-border bg-card p-4 text-left shadow-xs transition-all hover:border-amber-500/50 hover:bg-amber-50/40 dark:border-white/[0.08] dark:bg-[#16181a] dark:hover:border-[#f0a83c]/50 dark:hover:bg-[#1e1b17]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="line-clamp-1 font-sans text-[15px] font-semibold text-foreground transition-colors group-hover:text-amber-900 dark:group-hover:text-[#f0a83c]">
                          {niceTitle(titleOf(c))}
                        </h3>
                        <span className="shrink-0 text-[12px] text-muted-foreground">
                          {c.lastMs ? when(c.lastMs) : ""}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
                          {sourceGlyph(c.provider, "size-3.5") ?? <ProviderLogo provider={c.provider} className="size-3.5 grayscale" />}
                        </span>
                        <span className="text-[12px] font-medium text-muted-foreground">{PROVIDER_SHORT[c.provider]}</span>
                        {c.account && c.account !== "all" && c.account !== c.provider && (
                          <span className="text-[12px] text-muted-foreground/60">· {c.account}</span>
                        )}
                      </div>
                      {c.preview && (
                        <p className="mt-2.5 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground/90">
                          {c.preview}
                        </p>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Right Column: Activity Trend, Archive & Import */}
            <div className="space-y-6 lg:col-span-5">
              {/* Activity Trend */}
              <div className="rounded-xl border border-border bg-card p-5 shadow-xs dark:border-white/[0.08] dark:bg-[#16181a]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="size-4 text-[#f0a83c]" strokeWidth={1.75} />
                    <h3 className="font-sans text-[15px] font-semibold text-foreground">Activity Trend</h3>
                  </div>
                  <span className="text-[12px] text-muted-foreground">Last {DAYS} days</span>
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground">Daily conversation volume</p>

                <div className="mt-4">
                  {stats === null ? (
                    <Skeleton className="h-44 w-full" />
                  ) : (
                    <ChartContainer config={chartConfig} className="h-44 w-full [&_.recharts-cartesian-grid-horizontal_line:first-child]:stroke-transparent">
                      <AreaChart data={days} margin={{ left: 0, right: 0, top: 8, bottom: 0 }}>
                        <defs>
                          <linearGradient id="amberGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f0a83c" stopOpacity={0.4} />
                            <stop offset="95%" stopColor="#f0a83c" stopOpacity={0.0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="currentColor" className="text-border dark:text-white/[0.06]" />
                        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} tick={{ fontSize: 11, fill: "currentColor" }} className="text-muted-foreground dark:text-white/40" />
                        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
                        <Area type="monotone" dataKey="activity" stroke="#f0a83c" strokeWidth={2} fill="url(#amberGradient)" activeDot={{ r: 4, fill: "#f0a83c" }} />
                      </AreaChart>
                    </ChartContainer>
                  )}
                </div>
              </div>

              {/* Archive & Storage Card */}
              <div className="rounded-xl border border-border bg-card p-5 shadow-xs dark:border-white/[0.08] dark:bg-[#16181a]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <DatabaseBackup className="size-4 text-[#f0a83c]" strokeWidth={1.75} />
                    <h3 className="font-sans text-[15px] font-semibold text-foreground">Archive &amp; Storage</h3>
                  </div>
                  <span className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-600 dark:text-[#7bb661]">
                    <span className="size-2 rounded-full bg-emerald-600 dark:bg-[#7bb661]" />
                    Up to date
                  </span>
                </div>

                <div className="mt-3 space-y-2 text-[13px]">
                  <div className="flex justify-between py-1 border-b border-border/60 dark:border-white/[0.04]">
                    <span className="text-muted-foreground">Backup Location</span>
                    <span className="max-w-[200px] truncate text-foreground font-mono text-[12px]" title={backup?.path}>
                      {backup?.path ? "~/Documents/ChatVault Backup" : "Local folder"}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/60 dark:border-white/[0.04]">
                    <span className="text-muted-foreground">Import Drop-Folder</span>
                    <span className="max-w-[200px] truncate text-foreground font-mono text-[12px]" title="~/Documents/ChatVault Import">
                      ~/Documents/ChatVault Import
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-border/60 dark:border-white/[0.04]">
                    <span className="text-muted-foreground">Last Synced</span>
                    <span className="text-foreground tabular-nums">
                      {backup?.lastSyncMs ? when(backup.lastSyncMs) : "Up to date"}
                    </span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-muted-foreground">Archived History</span>
                    <span className="text-foreground tabular-nums font-semibold">
                      {(backup?.files ?? total).toLocaleString()} conversations
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={onSync}
                    className="flex-1 cursor-pointer rounded-lg border border-border bg-muted/60 py-2 text-center text-[13px] font-medium text-foreground transition-colors hover:bg-muted dark:border-white/[0.1] dark:bg-[#1a1c1e] dark:hover:bg-[#25282c]"
                  >
                    Sync Now
                  </button>
                  {onOpenBackup && (
                    <button
                      type="button"
                      onClick={onOpenBackup}
                      className="flex-1 cursor-pointer rounded-lg border border-border bg-muted/60 py-2 text-center text-[13px] font-medium text-foreground transition-colors hover:bg-muted dark:border-white/[0.1] dark:bg-[#1a1c1e] dark:hover:bg-[#25282c]"
                    >
                      Open Folder
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Dashboard Footer: Version, Privacy & Source links */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border/60 pt-6 text-[13px] text-muted-foreground dark:border-white/[0.06]">
            <div className="flex items-center gap-2">
              <span className="font-sans font-semibold text-foreground">ChatVault</span>
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-mono font-medium text-foreground/80">v0.6.2</span>
              <span>·</span>
              <span>100% Local-first workspace</span>
            </div>
            <div className="flex items-center gap-4 text-[13px]">
              <button
                type="button"
                onClick={() => setAboutOpen(true)}
                className="flex cursor-pointer items-center gap-1.5 font-medium text-foreground transition-colors hover:text-[#f0a83c]"
              >
                <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
                About &amp; Privacy
              </button>
              <span>·</span>
              <button
                type="button"
                onClick={() => void openUrl(REPO_URL)}
                className="cursor-pointer transition-colors hover:text-foreground"
              >
                Source code
              </button>
            </div>
          </div>
        </div>
      </FadedScroll>
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </ContextArea>
  );
}
