import { notifyError } from "@/toast";
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Check,
  CheckCircle2,
  Copy,
  DatabaseBackup,
  FileArchive,
  FileDown,
  FolderInput,
  FolderOpen,
  HardDrive,
  Info,
  Layers,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  UploadCloud,
} from "lucide-react";
import { open as pickFolder, save as pickSaveFile } from "@tauri-apps/plugin-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtDate, fmtSize } from "@/chat-actions";
import { startBulkExport, useBulkExport } from "@/bulk-export";
import { PanelHeader, RAIL_TAB, RailLabel } from "@/rail";
import { AUTO_SYNC_KEY, AUTO_SYNC_INTERVAL_KEY } from "@/store";

type SourceBreakdown = { source: string; label: string; files: number; bytes: number };
type Status = {
  path: string;
  exists: boolean;
  files: number;
  bytes: number;
  lastSyncMs: number | null;
  breakdown: SourceBreakdown[];
};
type Stats = { copied: number; skipped: number; failed: number; bytes: number; total: number };
type Prog = { phase: string; done: number; total: number; current: string };
type Where = { path: string; isDefault: boolean; defaultPath: string; previous: string | null; available: boolean };
type CheckLocation = { path: string; filesToMove: number; bytesToMove: number; isExistingBackup: boolean };

type RestoreCandidate = { source: string; filename: string; bytes: number };
type RestorePreview = {
  totalFiles: number;
  totalBytes: number;
  bySource: SourceBreakdown[];
  sampleCandidates: RestoreCandidate[];
};

export { AUTO_SYNC_KEY, AUTO_SYNC_INTERVAL_KEY } from "@/store";

const INTERVAL_OPTIONS = [
  { value: "10", label: "10 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "60", label: "1 hour" },
  { value: "360", label: "6 hours" },
];

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <p className="font-sans text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-[14px] font-semibold text-foreground whitespace-nowrap">{value}</p>
    </div>
  );
}

export function SyncDialog({
  open,
  onOpenChange,
  onChanged,
  onMove,
  toast,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
  /** A new backup folder was chosen and checked; the confirm step opens in its own dialog. */
  onMove: (c: CheckLocation) => void;
  toast: (m: string) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"sync" | "restore" | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [prog, setProg] = useState<Prog | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const exp = useBulkExport();
  const [auto, setAuto] = useState(() => localStorage.getItem(AUTO_SYNC_KEY) !== "0");
  const [intervalMin, setIntervalMin] = useState(() => localStorage.getItem(AUTO_SYNC_INTERVAL_KEY) || "10");
  const [where, setWhere] = useState<Where | null>(null);
  const [removing, setRemoving] = useState(false);
  const [tab, setTab] = useState<string>("backup");

  // Restore dry-run state
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [scanningRestore, setScanningRestore] = useState(false);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [copiedPath, setCopiedPath] = useState(false);

  const load = useCallback(() => {
    invoke<Status>("backup_status").then(setStatus).catch(() => {});
    invoke<Where>("backup_location_info").then(setWhere).catch(() => {});
  }, []);

  const scanRestore = useCallback(async () => {
    setScanningRestore(true);
    try {
      const p = await invoke<RestorePreview>("preview_restore_chats");
      setRestorePreview(p);
      setSelectedSources(p.bySource.map((s) => s.source));
    } catch (e) {
      notifyError(e);
    } finally {
      setScanningRestore(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setLast(null);
      load();
      if (tab === "restore") {
        void scanRestore();
      }
    }
  }, [open, load, tab, scanRestore]);

  useEffect(() => {
    const un = listen<Prog>("sync-progress", (e) => setProg(e.payload));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  /** Checks a folder for the backup. Nothing changes until the choice is confirmed. */
  const propose = async (path: string) => {
    const c = await invoke<CheckLocation>("check_backup_location", { path });
    setLast(null);
    onOpenChange(false);
    onMove(c);
  };

  const chooseFolder = async () => {
    try {
      const picked = await pickFolder({
        directory: true,
        multiple: false,
        title: "Choose the backup folder",
        defaultPath: status?.path || undefined,
      });
      if (typeof picked === "string") await propose(picked);
    } catch (e) {
      notifyError(e);
    }
  };

  const useDefaultFolder = async () => {
    if (!where) return;
    try {
      await propose(where.defaultPath);
    } catch (e) {
      notifyError(e);
    }
  };

  const removePrevious = async () => {
    setRemoving(true);
    try {
      await invoke("delete_previous_backup");
      toast("The old backup folder is in the Recycle Bin");
      load();
    } catch (e) {
      notifyError(e);
    } finally {
      setRemoving(false);
    }
  };

  const copyPath = async () => {
    if (!status?.path) return;
    try {
      await navigator.clipboard.writeText(status.path);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 1500);
    } catch (e) {
      notifyError(e);
    }
  };

  const runSync = async () => {
    setBusy("sync");
    setProg(null);
    try {
      const s = await invoke<Stats>("sync_chats");
      setLast(
        `Copied ${s.copied} files (${fmtSize(s.bytes)}). ${s.skipped} were already up to date.${s.failed ? ` ${s.failed} could not be copied.` : ""}`,
      );
      toast("Chats synced to the backup folder");
      load();
      onChanged();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(null);
    }
  };

  const runRestore = async (sourcesToRestore?: string[]) => {
    setBusy("restore");
    setProg(null);
    try {
      const s = await invoke<Stats>("restore_selected_chats", { sources: sourcesToRestore || null });
      setLast(
        `Restored ${s.copied} files (${fmtSize(s.bytes)}). ${s.skipped} were already up to date.${s.failed ? ` ${s.failed} could not be copied.` : ""}`,
      );
      toast("Missing chats restored successfully");
      load();
      await scanRestore();
      onChanged();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(null);
    }
  };

  const createTarball = async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const target = await pickSaveFile({
        title: "Save compressed backup archive",
        defaultPath: `chatvault-backup-${today}.tar.gz`,
        filters: [{ name: "Compressed Tarball", extensions: ["tar.gz", "tgz"] }],
      });
      if (!target || typeof target !== "string") return;
      setArchiving(true);
      const res = await invoke<{ files: number; bytes: number; path: string }>("create_backup_tarball", {
        archivePath: target,
      });
      toast(`Archive created: ${res.files.toLocaleString()} files (${fmtSize(res.bytes)})`);
    } catch (e) {
      notifyError(e);
    } finally {
      setArchiving(false);
    }
  };

  const toggleSourceSelection = (source: string) => {
    setSelectedSources((prev) =>
      prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source],
    );
  };

  const selectAllSources = () => {
    if (!restorePreview) return;
    setSelectedSources(restorePreview.bySource.map((s) => s.source));
  };

  const deselectAllSources = () => {
    setSelectedSources([]);
  };

  const pct = prog && prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
  const icon = "size-4 text-muted-foreground";

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="flex max-h-[min(90dvh,44rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        {/* Header */}
        <DialogHeader className="border-b border-border/70 px-6 py-4 dark:border-white/[0.08]">
          <div className="flex items-center gap-3.5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-900 shadow-xs dark:bg-[#362c21] dark:text-[#f0a83c]">
              <DatabaseBackup className="size-5" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <DialogTitle className="font-sans text-[18px] font-bold text-foreground">Sync &amp; Backup</DialogTitle>
                <Badge variant="secondary" className="h-5 px-2 font-mono text-[10px] font-medium">
                  Local-first
                </Badge>
              </div>
              <DialogDescription className="text-[13px] text-muted-foreground">
                Preserve, verify, and export your chat history across coding tools.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Content Body with Left Tabs Rail */}
        <Tabs
          orientation="vertical"
          value={tab}
          onValueChange={(v) => {
            setTab(String(v));
            if (String(v) === "restore") void scanRestore();
          }}
          className="min-h-0 flex-1 flex-col gap-0 sm:flex-row"
        >
          <ScrollArea
            className="shrink-0 border-b border-border/70 sm:w-56 sm:border-b-0 sm:border-r dark:border-white/[0.08]"
            viewportClassName="max-h-[min(72dvh,34rem)]"
          >
            <TabsList variant="line" className="h-auto w-full flex-col items-stretch gap-1 p-3" aria-label="Sync and backup sections">
              <RailLabel first>Backup</RailLabel>
              <TabsTrigger value="backup" className={RAIL_TAB}>
                <HardDrive className="size-4 shrink-0" strokeWidth={1.5} /> Backup folder
              </TabsTrigger>
              <TabsTrigger value="restore" className={RAIL_TAB}>
                <RotateCcw className="size-4 shrink-0" strokeWidth={1.5} /> Restore
              </TabsTrigger>
              <TabsTrigger value="auto" className={RAIL_TAB}>
                <RefreshCw className="size-4 shrink-0" strokeWidth={1.5} />
                <span className="min-w-0 flex-1 truncate text-left">Automatic</span>
                <span className="shrink-0 text-[10px] font-mono font-medium text-muted-foreground">
                  {auto ? `${intervalMin}m` : "Off"}
                </span>
              </TabsTrigger>

              <RailLabel>Files</RailLabel>
              <TabsTrigger value="export" className={RAIL_TAB}>
                <FileDown className="size-4 shrink-0" strokeWidth={1.5} /> Bulk Export
              </TabsTrigger>
            </TabsList>
          </ScrollArea>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ScrollArea className="min-h-0 min-w-0 flex-1" viewportClassName="max-h-[min(72dvh,34rem)]">
              <div className="space-y-6 p-6">
                {/* Tab 1: Backup */}
                <TabsContent value="backup" className="mt-0 space-y-5">
                  <PanelHeader
                    icon={<HardDrive className={icon} strokeWidth={1.5} />}
                    title="Backup folder"
                    hint="Where durable, offline copies of your conversations are kept."
                    action={
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!!busy || archiving}
                          className="cursor-pointer gap-2 shadow-xs"
                          onClick={() => void createTarball()}
                        >
                          {archiving ? <Loader2 className="size-3.5 animate-spin" /> : <FileArchive className="size-3.5" />}
                          Create Archive (.tar.gz)
                        </Button>
                        <Button
                          size="sm"
                          disabled={!!busy || archiving}
                          className="cursor-pointer gap-2 shadow-xs bg-amber-500 hover:bg-amber-600 text-amber-950 font-semibold dark:bg-[#f0a83c] dark:hover:bg-[#f3b558] dark:text-[#18120c]"
                          onClick={() => void runSync()}
                        >
                          {busy === "sync" ? <Loader2 className="size-3.5 animate-spin" /> : <UploadCloud className="size-3.5" />}
                          Sync now
                        </Button>
                      </div>
                    }
                  />

                  {where && !where.available && (
                    <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/5 p-3.5 text-xs">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" strokeWidth={1.5} />
                      <p className="text-foreground">
                        The backup folder cannot be reached right now. Is the drive connected? Backups wait until it is back, and nothing is saved anywhere else.
                      </p>
                    </div>
                  )}

                  {/* Modern Location Card */}
                  <div className="overflow-hidden rounded-xl border border-border bg-card shadow-xs dark:border-white/[0.08] dark:bg-[#16181a]">
                    <div className="flex min-w-0 items-start justify-between gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-sans text-[13px] font-semibold text-foreground">Storage Location</span>
                          {where && (
                            <Badge
                              variant="secondary"
                              className={
                                where.isDefault
                                  ? "h-4.5 border-emerald-500/20 bg-emerald-500/10 px-2 font-mono text-[10px] font-medium text-emerald-700 dark:text-emerald-400"
                                  : "h-4.5 border-amber-500/20 bg-amber-500/10 px-2 font-mono text-[10px] font-medium text-amber-900 dark:text-[#f0a83c]"
                              }
                            >
                              {where.isDefault ? "Default" : "Custom"}
                            </Badge>
                          )}
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <code className="min-w-0 truncate rounded-md bg-muted/60 px-2 py-1 font-mono text-[12px] text-muted-foreground select-all dark:bg-white/[0.04]">
                            {status?.path || "…"}
                          </code>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
                            onClick={() => void copyPath()}
                            title="Copy path"
                          >
                            {copiedPath ? <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="size-3.5" />}
                          </Button>
                        </div>
                        {where && !where.isDefault && (
                          <button
                            type="button"
                            disabled={!!busy}
                            onClick={() => void useDefaultFolder()}
                            className="mt-2 cursor-pointer font-sans text-[12px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Reset to default folder
                          </button>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 cursor-pointer text-muted-foreground hover:text-foreground"
                          aria-label="Open the backup folder"
                          onClick={() => invoke("open_backup_folder").catch((e) => toast(String(e)))}
                          title="Open folder"
                        >
                          <FolderOpen className="size-4" strokeWidth={1.5} />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!!busy}
                          onClick={() => void chooseFolder()}
                          className="cursor-pointer gap-1.5 shadow-xs"
                        >
                          <FolderInput className="size-3.5" /> Change…
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.4fr)] divide-x divide-border/60 border-t border-border/60 bg-muted/30 dark:divide-white/[0.06] dark:border-white/[0.06] dark:bg-white/[0.02]">
                      <StatCard label="Total Files" value={status ? status.files.toLocaleString() : "…"} />
                      <StatCard label="Backup Size" value={status ? fmtSize(status.bytes) : "…"} />
                      <StatCard label="Last Synced" value={status?.lastSyncMs ? fmtDate(status.lastSyncMs) : "Never"} />
                    </div>

                    {where?.previous && (
                      <div className="min-w-0 space-y-2 border-t border-border/60 p-4 text-xs dark:border-white/[0.06]">
                        <div>
                          <p className="font-sans font-semibold text-foreground">Previous Backup Folder</p>
                          <p className="mt-0.5 break-all font-mono text-muted-foreground">{where.previous}</p>
                          <p className="mt-1 text-muted-foreground">
                            It is no longer used. You can safely remove it once you verify the new backup.
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => void invoke("open_folder", { path: where.previous })}>
                            <FolderOpen className="size-3.5" /> Open
                          </Button>
                          <Button variant="outline" size="sm" disabled={removing} onClick={() => void removePrevious()}>
                            {removing ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Move to Recycle Bin
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Source Breakdown Section */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-sans text-[13px] font-semibold text-foreground">Backup Contents by Source</h4>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {status?.breakdown ? `${status.breakdown.length} active sources` : "Scanning…"}
                      </span>
                    </div>

                    {status?.breakdown && status.breakdown.length > 0 ? (
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                        {status.breakdown.map((item) => (
                          <div
                            key={item.source}
                            className="rounded-lg border border-border/80 bg-card/60 p-3 shadow-xs dark:border-white/[0.06] dark:bg-white/[0.02]"
                          >
                            <p className="truncate font-sans text-[12px] font-semibold text-foreground">{item.label}</p>
                            <div className="mt-1 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
                              <span>{item.files.toLocaleString()} files</span>
                              <span>{fmtSize(item.bytes)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border/80 p-5 text-center text-xs text-muted-foreground dark:border-white/[0.08]">
                        No files in the backup folder yet. Press "Sync now" above to perform the first backup.
                      </div>
                    )}

                    {/* Hermes & Antigravity Architectural Transparency */}
                    <div className="flex items-start gap-2.5 rounded-xl border border-border/70 bg-muted/40 p-3.5 text-xs leading-relaxed text-muted-foreground dark:border-white/[0.06] dark:bg-white/[0.02]">
                      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <p>
                        <strong className="text-foreground">Hermes Agent &amp; Antigravity safety:</strong> Conversations from Hermes Agent and Antigravity
                        are fully preserved through normalized, independent snapshots inside the <code className="font-mono text-foreground">archive/</code> folder.
                        Direct live SQLite database manipulation is prevented to protect tool integrity.
                      </p>
                    </div>
                  </div>

                  {last && !busy && tab === "backup" && (
                    <p className="rounded-xl border border-border/80 bg-muted/30 p-3 font-sans text-[13px] text-foreground dark:border-white/[0.08]">
                      {last}
                    </p>
                  )}
                </TabsContent>

                {/* Tab 2: Restore */}
                <TabsContent value="restore" className="mt-0 space-y-5">
                  <PanelHeader
                    icon={<RotateCcw className={icon} strokeWidth={1.5} />}
                    title="Restore missing chats"
                    hint="Recover chats that have disappeared from their native tools without overwriting existing sessions."
                    action={
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={scanningRestore || !!busy}
                        onClick={() => void scanRestore()}
                        className="cursor-pointer gap-2 shadow-xs"
                      >
                        {scanningRestore ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                        Scan missing
                      </Button>
                    }
                  />

                  {/* Dry Run Status Card */}
                  {scanningRestore ? (
                    <div className="flex flex-col items-center justify-center rounded-xl border border-border p-8 text-center dark:border-white/[0.08]">
                      <Loader2 className="size-6 animate-spin text-amber-500" />
                      <p className="mt-2 font-sans text-[13px] font-medium text-foreground">Scanning backup and live directories…</p>
                      <p className="text-[12px] text-muted-foreground">Comparing timestamps and file presence.</p>
                    </div>
                  ) : restorePreview ? (
                    restorePreview.totalFiles === 0 ? (
                      <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-emerald-900 dark:border-emerald-500/20 dark:text-emerald-300">
                        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        <div>
                          <p className="font-sans text-[14px] font-semibold">Everything is up to date</p>
                          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                            All backed-up chats are currently present on this computer. No files need to be restored.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 dark:border-amber-500/20">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-sans text-[14px] font-bold text-foreground">Missing chats detected</span>
                              <Badge className="bg-amber-500/20 text-amber-900 dark:text-[#f0a83c]">
                                {restorePreview.totalFiles} chats · {fmtSize(restorePreview.totalBytes)}
                              </Badge>
                            </div>
                            <p className="mt-1 text-[12px] text-muted-foreground">
                              Select which tools you would like to restore back into their native directories.
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={selectedSources.length === 0 || !!busy}
                              onClick={() => void runRestore(selectedSources)}
                              className="cursor-pointer gap-2 shadow-xs"
                            >
                              {busy === "restore" ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                              Restore selected ({selectedSources.length})
                            </Button>
                            <Button
                              size="sm"
                              disabled={!!busy}
                              onClick={() => void runRestore()}
                              className="cursor-pointer gap-2 shadow-xs bg-amber-500 hover:bg-amber-600 text-amber-950 font-semibold dark:bg-[#f0a83c] dark:hover:bg-[#f3b558] dark:text-[#18120c]"
                            >
                              Restore all
                            </Button>
                          </div>
                        </div>

                        {/* Source Selection Checkboxes */}
                        <div className="rounded-xl border border-border bg-card p-4 shadow-xs dark:border-white/[0.08] dark:bg-[#16181a]">
                          <div className="flex items-center justify-between border-b border-border/60 pb-3 dark:border-white/[0.06]">
                            <span className="font-sans text-[13px] font-semibold text-foreground">Available for restoration</span>
                            <div className="flex items-center gap-2 text-xs">
                              <button
                                type="button"
                                onClick={selectAllSources}
                                className="cursor-pointer text-muted-foreground hover:text-foreground hover:underline"
                              >
                                Select all
                              </button>
                              <span className="text-muted-foreground">·</span>
                              <button
                                type="button"
                                onClick={deselectAllSources}
                                className="cursor-pointer text-muted-foreground hover:text-foreground hover:underline"
                              >
                                Deselect all
                              </button>
                            </div>
                          </div>

                          <div className="mt-3 space-y-2">
                            {restorePreview.bySource.map((s) => {
                              const checked = selectedSources.includes(s.source);
                              return (
                                <label
                                  key={s.source}
                                  className="flex cursor-pointer items-center justify-between rounded-lg border border-border/60 p-3 transition-colors hover:bg-muted/40 dark:border-white/[0.06] dark:hover:bg-white/[0.02]"
                                >
                                  <div className="flex items-center gap-3">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleSourceSelection(s.source)}
                                      className="size-4 rounded-sm border-border text-amber-500 focus:ring-amber-500"
                                    />
                                    <span className="font-sans text-[13px] font-medium text-foreground">{s.label}</span>
                                  </div>
                                  <span className="font-mono text-[12px] text-muted-foreground">
                                    {s.files} missing · {fmtSize(s.bytes)}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )
                  ) : null}

                  {last && !busy && tab === "restore" && (
                    <p className="rounded-xl border border-border/80 bg-muted/30 p-3 font-sans text-[13px] text-foreground dark:border-white/[0.08]">
                      {last}
                    </p>
                  )}
                </TabsContent>

                {/* Tab 3: Automatic Backup */}
                <TabsContent value="auto" className="mt-0 space-y-5">
                  <PanelHeader
                    icon={<RefreshCw className={icon} strokeWidth={1.5} />}
                    title="Automatic backup"
                    hint="Keep your backups synchronized in the background without manual prompts."
                  />

                  <div className="space-y-4">
                    <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4 shadow-xs dark:border-white/[0.08] dark:bg-[#16181a]">
                      <label className="min-w-0 flex-1 cursor-pointer pr-4">
                        <p className="font-sans text-[14px] font-semibold text-foreground">Background Sync</p>
                        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                          Runs once when ChatVault launches, and continuously at your chosen interval while open.
                        </p>
                      </label>
                      <Switch
                        checked={auto}
                        aria-label="Keep backing up automatically"
                        onCheckedChange={(v) => {
                          setAuto(v);
                          localStorage.setItem(AUTO_SYNC_KEY, v ? "1" : "0");
                        }}
                      />
                    </div>

                    {/* Interval Options */}
                    <div className="rounded-xl border border-border bg-card p-4 shadow-xs dark:border-white/[0.08] dark:bg-[#16181a]">
                      <p className="font-sans text-[13px] font-semibold text-foreground">Sync Frequency</p>
                      <p className="mt-0.5 text-[12px] text-muted-foreground">
                        How often ChatVault scans and copies new chats while running.
                      </p>

                      <div className="mt-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                        {INTERVAL_OPTIONS.map((opt) => {
                          const active = intervalMin === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              disabled={!auto}
                              onClick={() => {
                                setIntervalMin(opt.value);
                                localStorage.setItem(AUTO_SYNC_INTERVAL_KEY, opt.value);
                              }}
                              className={`flex flex-col items-center justify-center rounded-lg border p-3 text-center transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                                active
                                  ? "border-amber-500/50 bg-amber-500/10 text-foreground shadow-xs dark:bg-[#362c21] dark:text-[#f0a83c]"
                                  : "border-border/80 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground dark:border-white/[0.06] dark:bg-white/[0.02]"
                              }`}
                            >
                              <span className="font-sans text-[13px] font-semibold">{opt.label}</span>
                              <span className="mt-0.5 font-mono text-[10px] opacity-75">{opt.value} minutes</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </TabsContent>

                {/* Tab 4: Export */}
                <TabsContent value="export" className="mt-0 space-y-5">
                  <PanelHeader
                    icon={<FileDown className={icon} strokeWidth={1.5} />}
                    title="Bulk Export"
                    hint="Export all indexed chats into durable files for external archiving or processing."
                  />

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/* Markdown Bulk Export */}
                    <div className="flex flex-col justify-between rounded-xl border border-border bg-card p-4 shadow-xs dark:border-white/[0.08] dark:bg-[#16181a]">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-sans text-[14px] font-semibold text-foreground">Markdown Export</span>
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            .md
                          </Badge>
                        </div>
                        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                          Generates human-readable Markdown files grouped by tool folder. Re-exporting cleanly updates files.
                        </p>
                      </div>
                      <div className="mt-4">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={exp.running}
                          onClick={() => void startBulkExport("markdown")}
                          className="w-full cursor-pointer gap-2 shadow-xs"
                        >
                          {exp.running ? <Loader2 className="size-3.5 animate-spin" /> : <FileDown className="size-3.5" />}
                          Export as Markdown
                        </Button>
                      </div>
                    </div>

                    {/* JSON Bulk Export */}
                    <div className="flex flex-col justify-between rounded-xl border border-border bg-card p-4 shadow-xs dark:border-white/[0.08] dark:bg-[#16181a]">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-sans text-[14px] font-semibold text-foreground">JSON Structured Export</span>
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            .json
                          </Badge>
                        </div>
                        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                          Exports fully structured JSON objects with all metadata, timestamps, roles, and message content intact.
                        </p>
                      </div>
                      <div className="mt-4">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={exp.running}
                          onClick={() => void startBulkExport("json")}
                          className="w-full cursor-pointer gap-2 shadow-xs"
                        >
                          {exp.running ? <Loader2 className="size-3.5 animate-spin" /> : <Layers className="size-3.5" />}
                          Export as JSON
                        </Button>
                      </div>
                    </div>
                  </div>

                  {exp.running && (
                    <div className="rounded-xl border border-border bg-card p-4 shadow-xs dark:border-white/[0.08] dark:bg-[#16181a]">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs font-medium text-foreground">
                          <span>Exporting conversations…</span>
                          <span className="font-mono">
                            {exp.total ? `${Math.round((exp.done / exp.total) * 100)}%` : "Preparing…"}
                          </span>
                        </div>
                        <Progress value={exp.total ? Math.round((exp.done / exp.total) * 100) : null} />
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {exp.total
                            ? `${exp.done.toLocaleString()} of ${exp.total.toLocaleString()} · ${exp.current}`
                            : "Scanning files…"}
                        </p>
                      </div>
                    </div>
                  )}
                </TabsContent>

                {/* Footer Note */}
                <div role="note" className="flex items-start gap-2.5 rounded-xl bg-muted/40 p-3.5 text-xs text-muted-foreground dark:bg-white/[0.02]">
                  <Info className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
                  <p>
                    All backup and sync operations are 100% local. Your conversations never leave this machine.
                  </p>
                </div>
              </div>
            </ScrollArea>

            {/* In-progress bar during active backup/restore */}
            {busy && (
              <div className="min-w-0 space-y-2 border-t border-border/70 bg-card/80 px-6 py-3.5 backdrop-blur-sm dark:border-white/[0.08] dark:bg-[#16181a]/80">
                <div className="flex items-center justify-between font-sans text-xs font-semibold text-foreground">
                  <span className="capitalize">{prog ? prog.phase : "Working…"}</span>
                  <span className="font-mono">{pct}%</span>
                </div>
                <Progress value={pct} />
                <p className="block w-full min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                  {prog ? `${prog.done.toLocaleString()} of ${prog.total.toLocaleString()} · ${prog.current}` : "Initializing…"}
                </p>
              </div>
            )}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
