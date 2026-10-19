import { notifyError } from "@/toast";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DatabaseBackup, FileDown, FolderOpen, Info, Loader2, RefreshCw, RotateCcw, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { fmtDate, fmtSize } from "@/chat-actions";
import { startBulkExport, useBulkExport } from "@/bulk-export";
import { AUTO_SYNC_KEY } from "@/store";

type Status = { path: string; exists: boolean; files: number; bytes: number; lastSyncMs: number | null };
type Stats = { copied: number; skipped: number; failed: number; bytes: number; total: number };
type Prog = { phase: string; done: number; total: number; current: string };

export { AUTO_SYNC_KEY } from "@/store";

export function SyncDialog({
  open,
  onOpenChange,
  onChanged,
  toast,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onChanged: () => void;
  toast: (m: string) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"sync" | "restore" | null>(null);
  const [prog, setProg] = useState<Prog | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const exp = useBulkExport();
  const [auto, setAuto] = useState(() => localStorage.getItem(AUTO_SYNC_KEY) !== "0");

  const load = useCallback(() => {
    invoke<Status>("backup_status").then(setStatus).catch(() => {});
  }, []);
  useEffect(() => {
    if (open) {
      setLast(null);
      load();
    }
  }, [open, load]);
  useEffect(() => {
    const un = listen<Prog>("sync-progress", (e) => setProg(e.payload));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  const run = async (kind: "sync" | "restore") => {
    setBusy(kind);
    setProg(null);
    try {
      const s = await invoke<Stats>(kind === "sync" ? "sync_chats" : "restore_chats");
      setLast(
        `${kind === "sync" ? "Copied" : "Restored"} ${s.copied} files (${fmtSize(s.bytes)}). ${s.skipped} were already up to date.${s.failed ? ` ${s.failed} could not be copied.` : ""}`,
      );
      toast(kind === "sync" ? "Chats synced to Documents" : "Missing chats restored");
      load();
      onChanged();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(null);
    }
  };

  const pct = prog && prog.total ? Math.round((prog.done / prog.total) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto overflow-x-hidden sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <DatabaseBackup className="size-4 text-muted-foreground" strokeWidth={1.5} />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-medium">Sync &amp; backup</DialogTitle>
              <DialogDescription>Keep a copy of your chats in Documents.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-w-0 space-y-3">
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <Row
              label="Backup folder"
              value={
                <span className="inline-flex items-start gap-1">
                  <span>{status?.path || "…"}</span>
                  <Button variant="ghost" size="icon" className="-my-1 size-6 shrink-0 text-muted-foreground" aria-label="Open the backup folder" onClick={() => invoke("open_backup_folder").catch((e) => toast(String(e)))}>
                    <FolderOpen className="size-3.5" />
                  </Button>
                </span>
              }
              mono
            />
            <Row label="Files" value={status ? `${status.files.toLocaleString()} · ${fmtSize(status.bytes)}` : "…"} />
            <Row label="Last sync" value={status?.lastSyncMs ? fmtDate(status.lastSyncMs) : "Never"} />
          </div>

          {busy && (
            <div className="min-w-0 space-y-1.5">
              <Progress value={pct} />
              <p className="block w-full min-w-0 truncate text-xs text-muted-foreground">
                {prog ? `${prog.phase} ${prog.done.toLocaleString()} of ${prog.total.toLocaleString()} · ${prog.current}` : "Getting ready…"}
              </p>
            </div>
          )}
          {last && !busy && <p className="rounded-lg border p-3 text-sm">{last}</p>}

          <div className="grid grid-cols-2 gap-2">
            <Button disabled={!!busy} onClick={() => run("sync")}>
              {busy === "sync" ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />} Sync now
            </Button>
            <Button variant="outline" disabled={!!busy} onClick={() => run("restore")}>
              {busy === "restore" ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />} Restore missing
            </Button>
          </div>


          <div className="rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                <FileDown className="size-4 text-muted-foreground" strokeWidth={1.5} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Export all chats as Markdown</p>
                <p className="text-xs text-muted-foreground">One .md file per chat. Exporting again replaces them.</p>
              </div>
              <Button variant="outline" size="sm" className="shrink-0" disabled={exp.running} onClick={() => void startBulkExport()}>
                {exp.running ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />} {exp.running ? "Exporting" : "Export"}
              </Button>
            </div>
            {exp.running && (
              <div className="mt-3 space-y-1.5">
                <Progress value={exp.total ? Math.round((exp.done / exp.total) * 100) : null} />
                <p className="truncate text-xs text-muted-foreground">
                  {exp.total ? `${exp.done.toLocaleString()} of ${exp.total.toLocaleString()}${exp.current ? ` · ${exp.current}` : ""}` : "Getting ready…"} · you can close this window
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 rounded-lg border p-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
              <RefreshCw className="size-4 text-muted-foreground" strokeWidth={1.5} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Keep backing up automatically</p>
              <p className="text-xs text-muted-foreground">Runs on open and every 10 minutes.</p>
            </div>
            <Switch
              checked={auto}
              onCheckedChange={(v) => {
                setAuto(v);
                localStorage.setItem(AUTO_SYNC_KEY, v ? "1" : "0");
              }}
            />
          </div>

          <div role="alert" className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.5} />
            <p>Backed-up chats stay visible after you sign out or reinstall. Restore missing only copies back chats that are gone, and never overwrites.</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-0.5">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`min-w-0 break-all text-right ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}
