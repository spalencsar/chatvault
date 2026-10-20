import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowRight, Check, Copy, Download, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { ProviderLogo } from "@/claude-logo";
import type { Provider } from "@/chat-actions";
import { notifyError } from "@/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type CliStatus = {
  tool: string; name: string; installed: boolean; ready: boolean;
  path: string | null; version: string | null; error: string | null;
  installCommand: string; docsUrl: string; prerequisite: string | null;
  desktopPath?: string | null;
};

function CliSetup({ initial, finish }: { initial: CliStatus; finish: (ready: boolean) => void }) {
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState<"install" | "check" | null>(null);
  // A failed check reports itself as a toast, like every other message in the app.
  useEffect(() => { if (status.error) notifyError(status.error); }, [status]);
  const [copied, setCopied] = useState(false);
  const run = async (kind: "install" | "check") => {
    setBusy(kind);
    try {
      const next = await invoke<CliStatus>(kind === "install" ? "install_cli" : "cli_status", { tool: status.tool });
      setStatus(next);
      if (!next.ready && !next.installed && kind === "check") notifyError(`${next.name} is still not installed.`);
    } catch (e) { notifyError(e); }
    finally { setBusy(null); }
  };
  const docs = (url: string) => { void openUrl(url).catch((e) => notifyError(e)); };
  const locate = async () => {
    setBusy("check");
    try {
      const path=await open({title:`Locate ${status.name} CLI`,multiple:false,directory:false,filters:[{name:"CLI executable",extensions:["exe","cmd","ps1"]}]});
      if (typeof path==="string") setStatus(await invoke<CliStatus>("set_cli_path",{tool:status.tool,path}));
    } catch(e) {notifyError(e);} finally {setBusy(null);}
  };
  const title = status.ready ? `${status.name} is ready` : status.installed ? `${status.name} needs attention` : `Set up ${status.name}`;
  const hint = status.ready
    ? "Installed and checked. Continue to open this chat in a terminal."
    : status.installed
      ? "The command was found, but a check failed. See the details below."
      : `Needed to continue this chat.`;
  const copy = () => { void navigator.clipboard.writeText(status.installCommand).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); };
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) finish(false); }}>
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <ProviderLogo provider={status.tool as Provider} className="size-4 shrink-0" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-medium">{title}</DialogTitle>
              <DialogDescription>{hint}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {status.ready ? (
          status.version && <p className="flex items-center gap-2 break-words rounded-lg border p-3 text-xs text-muted-foreground"><Check className="size-4 shrink-0 text-emerald-500" />{status.version}</p>
        ) : (
          <div className="space-y-3">
            {status.desktopPath && <p className="text-xs text-muted-foreground">The {status.name} app was found, but it has no command that ChatVault can use. Install the command below.</p>}
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Install command</p>
              <div className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1.5 pl-3 pr-1.5">
                <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs" aria-label="Installation command">{status.installCommand}</code>
                <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground" aria-label="Copy the command" onClick={copy}>
                  {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                </Button>
              </div>
            </div>
            {status.prerequisite && (
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3 text-xs">
                <p className="min-w-0">{status.prerequisite}</p>
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => docs("https://nodejs.org/en/download")}>Get Node.js</Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Already installed?{" "}
              <button type="button" disabled={!!busy} onClick={() => void run("check")} className="cursor-pointer underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50">Check again</button>
              {" or "}
              <button type="button" disabled={!!busy} onClick={() => void locate()} className="cursor-pointer underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50">choose where it is</button>.
            </p>
          </div>
        )}

        {busy && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{busy === "install" ? "Installing… this can take a few minutes." : "Checking…"}</p>}

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="mr-auto text-muted-foreground" disabled={!!busy} onClick={() => docs(status.docsUrl)}><ExternalLink className="size-3.5" />Setup guide</Button>
          <Button variant="ghost" disabled={!!busy} onClick={() => finish(false)}>Cancel</Button>
          {status.ready ? (
            <Button onClick={() => finish(true)}>Continue<ArrowRight className="size-3.5" /></Button>
          ) : !status.installed ? (
            <Button disabled={!!busy || !!status.prerequisite} onClick={() => void run("install")}>{busy === "install" ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}Install</Button>
          ) : (
            <Button disabled={!!busy} onClick={() => void run("check")}><RefreshCw className="size-4" />Check again</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Loaded only when a Continue action needs setup; no startup scan or eager dialog.
let active: Promise<boolean> | null = null;
export async function ensureCli(tool: string): Promise<boolean> {
  const status = await invoke<CliStatus>("cli_status", { tool });
  if (status.ready) return true;
  if (active) { await active; return false; }
  active = new Promise<boolean>((resolve) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    root.render(<CliSetup initial={status} finish={(ready) => {
      resolve(ready);
      setTimeout(() => { root.unmount(); host.remove(); }, 0);
    }} />);
  });
  try { return await active; } finally { active = null; }
}
