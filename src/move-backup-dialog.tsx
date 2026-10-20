import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Check, FolderInput, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { fmtSize } from "@/chat-actions";
import { notifyError } from "@/toast";

export type BackupCheck = { path: string; filesToMove: number; bytesToMove: number; isExistingBackup: boolean };
type Moved = { copied: number; skipped: number; bytes: number; path: string; moved: boolean };
type Prog = { done: number; total: number; current: string };

/** One of the two things that can happen to the current backup: a card you pick, with a check when it is chosen. */
function Choice({ selected, disabled, icon, title, children, onSelect }: { selected: boolean; disabled?: boolean; icon: ReactNode; title: string; children: ReactNode; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        selected ? "border-foreground/20 bg-muted/50" : "hover:bg-muted/30",
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{children}</span>
      </span>
      <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors", selected ? "border-foreground/80 bg-foreground text-background" : "border-muted-foreground/30")} aria-hidden="true">
        {selected && <Check className="size-3" strokeWidth={3} />}
      </span>
    </button>
  );
}

/**
 * Confirms a new backup folder. It opens on its own, after Sync & backup has closed, and Sync & backup comes back
 * when this one is finished or cancelled. Nothing changes until "Move and switch" or "Switch" is pressed.
 */
export function MoveBackupDialog({
  check,
  onClose,
  onDone,
  toast,
}: {
  check: BackupCheck | null;
  /** Cancelled: nothing was changed. */
  onClose: () => void;
  /** The backup folder was switched. */
  onDone: () => void;
  toast: (m: string) => void;
}) {
  const [moveFiles, setMoveFiles] = useState(true);
  const [moving, setMoving] = useState(false);
  const [prog, setProg] = useState<Prog | null>(null);
  const [from, setFrom] = useState<string>("");

  useEffect(() => {
    if (!check) return;
    setMoveFiles(!check.isExistingBackup && check.filesToMove > 0);
    setProg(null);
    invoke<{ path: string }>("backup_location_info").then((i) => setFrom(i.path)).catch(() => {});
  }, [check]);
  useEffect(() => {
    const un = listen<Prog>("backup-move-progress", (e) => setProg(e.payload));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  const confirm = async () => {
    if (!check) return;
    setMoving(true);
    setProg(null);
    try {
      const r = await invoke<Moved>("set_backup_location", { path: check.path, moveFiles });
      toast(r.moved ? `Backup moved: ${r.copied.toLocaleString()} files (${fmtSize(r.bytes)}) copied. The old folder is still where it was.` : "Backup folder changed. The old folder was left as it was.");
      onDone();
    } catch (e) {
      notifyError(e);
    } finally {
      setMoving(false);
    }
  };

  const pct = prog && prog.total ? Math.round((prog.done / prog.total) * 100) : 0;
  const nothingToMove = !check || check.filesToMove === 0;

  return (
    <Dialog open={!!check} onOpenChange={(o) => !o && !moving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <FolderInput className="size-4 text-muted-foreground" strokeWidth={1.5} />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-medium">{check?.isExistingBackup ? "Use this backup folder?" : "Move the backup"}</DialogTitle>
              <DialogDescription>{check?.isExistingBackup ? "This folder already holds a ChatVault backup, so it is used as it is." : "Choose what happens to the backup you have now."}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {check && (
          <div className="min-w-0 space-y-4">
            <div className="rounded-xl border bg-muted/20 p-3.5">
              <div className="grid grid-cols-[auto_1fr] gap-x-3">
                <div className="flex flex-col items-center pt-1" aria-hidden="true">
                  <span className="size-2 rounded-full border border-muted-foreground/60" />
                  <span className="my-1 w-px flex-1 bg-border" />
                  <span className="size-2 rounded-full bg-foreground" />
                </div>
                <div className="min-w-0 space-y-3 text-xs">
                  <div className="min-w-0">
                    <p className="text-muted-foreground">From</p>
                    <p className="mt-0.5 break-all font-mono text-muted-foreground/80">{from || "…"}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-muted-foreground">To</p>
                    <p className="mt-0.5 break-all font-mono">{check.path}</p>
                  </div>
                </div>
              </div>
            </div>

            <div role="radiogroup" aria-label="What to do with the current backup" className="space-y-2">
              <Choice selected={moveFiles} disabled={moving || nothingToMove} icon={<FolderInput className="size-4" strokeWidth={1.5} />} title="Move my current backup" onSelect={() => setMoveFiles(true)}>
                {nothingToMove ? "There is nothing in the current backup to move." : `${check.filesToMove.toLocaleString()} files · ${fmtSize(check.bytesToMove)}. They are copied and checked first. The old folder stays until you remove it.`}
              </Choice>
              <Choice selected={!moveFiles} disabled={moving} icon={<FolderPlus className="size-4" strokeWidth={1.5} />} title="Start fresh" onSelect={() => setMoveFiles(false)}>
                Nothing is copied. The old folder is left as it is, and the next sync fills the new one.
              </Choice>
            </div>

            {moving && (
              <div className="min-w-0 space-y-1.5">
                <Progress value={pct} />
                <p className="block w-full min-w-0 truncate text-xs text-muted-foreground">
                  {prog ? `Copying ${prog.done.toLocaleString()} of ${prog.total.toLocaleString()} · ${prog.current}` : "Getting ready…"}
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {moving ? (
            <Button variant="outline" onClick={() => void invoke("cancel_backup_move")}>
              Cancel the move
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={() => void confirm()} disabled={!check}>
                {moveFiles ? "Move and switch" : "Switch"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
