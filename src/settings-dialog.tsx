import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Check,
  Copy,
  FilePlus2,
  FolderOpen,
  Info,
  Loader2,
  Moon,
  Palette,
  Settings,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProviderLogo } from "@/claude-logo";
import { fmtSize, type Provider } from "@/chat-actions";
import { notify, notifyError } from "@/toast";
import { describeImport, importNousSave } from "@/import-noussave";
import { PanelHeader, RAIL_TAB, RailLabel } from "@/rail";
import { cn } from "@/lib/utils";

type Location = { label: string; path: string; isFile: boolean; exists: boolean; items: number | null; bytes: number | null };
type Source = { provider: Provider; name: string; enabled: boolean; locations: Location[] };

/** One place chats are read from: what it is, where it is, whether it is there, and how much is in it. */
function LocationCard({ loc, onOpen }: { loc: Location; onOpen: () => void }) {
  const [copied, setCopied] = useState(false);

  const copyPath = (e: MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(loc.path);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const facts = [
    loc.items !== null ? `${loc.items.toLocaleString()} ${loc.items === 1 ? "chat" : "chats"}` : null,
    loc.bytes !== null ? fmtSize(loc.bytes) : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="flex min-w-0 items-start justify-between gap-3.5 rounded-xl border border-border bg-card p-3.5 shadow-xs transition-colors hover:border-border/80 dark:border-white/[0.08] dark:bg-[#16181a]">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-sans text-[14px] font-semibold text-foreground">{loc.label}</span>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide",
              loc.exists
                ? "border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "border border-border bg-muted/60 text-muted-foreground",
            )}
          >
            {loc.exists ? "Found" : "Not found"}
          </span>
          {facts && <span className="text-[12px] tabular-nums text-muted-foreground/80">{facts}</span>}
        </div>
        <p className="break-all font-mono text-[12px] leading-relaxed text-muted-foreground select-all">{loc.path}</p>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 cursor-pointer rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={copied ? "Path copied!" : "Copy path"}
          onClick={copyPath}
        >
          {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" strokeWidth={1.5} />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 cursor-pointer rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          disabled={!loc.exists}
          title={loc.isFile ? "Show file in file manager" : "Open folder in file manager"}
          onClick={onOpen}
        >
          <FolderOpen className="size-4" strokeWidth={1.5} />
        </Button>
      </div>
    </div>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  onToolsChanged,
  dark,
  onSetDark,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** A tool was switched on or off: the lists are redrawn and re-read. */
  onToolsChanged: () => void | Promise<void>;
  dark?: boolean;
  onSetDark?: (dark: boolean) => void;
}) {
  const [sources, setSources] = useState<Source[] | null>(null);
  const [tab, setTab] = useState<string>("claude");
  const [importing, setImporting] = useState(false);

  const load = useCallback(() => {
    setSources(null);
    invoke<Source[]>("chat_sources")
      .then(setSources)
      .catch((e) => {
        setSources([]);
        notifyError(e);
      });
  }, []);
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const openPlace = (path: string) => void invoke("open_chat_source", { path }).catch(notifyError);
  const runImport = async (directory: boolean) => {
    setImporting(true);
    try {
      const r = await importNousSave(directory);
      if (!r) return;
      if (r.added === 0 && r.failed.length) notifyError(describeImport(r));
      else notify(describeImport(r));
      load();
      if (r.added) await onToolsChanged();
    } catch (e) {
      notifyError(e);
    } finally {
      setImporting(false);
    }
  };
  const [switching, setSwitching] = useState<string | null>(null);
  const toggle = async (s: Source, enabled: boolean) => {
    setSwitching(s.provider);
    try {
      await invoke("set_integration", { provider: s.provider, enabled });
      setSources((list) => (list ?? []).map((x) => (x.provider === s.provider ? { ...x, enabled } : x)));
      await onToolsChanged();
    } catch (e) {
      notifyError(e);
    } finally {
      setSwitching(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(88dvh,42rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border/70 px-6 py-4 dark:border-white/[0.08]">
          <div className="flex items-center gap-3.5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-900 shadow-xs dark:bg-[#362c21] dark:text-[#f0a83c]">
              <Settings className="size-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <DialogTitle className="font-sans text-[18px] font-bold text-foreground">Settings</DialogTitle>
              <DialogDescription className="text-[13px] text-muted-foreground">Where ChatVault finds your chats, tool by tool.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <Tabs orientation="vertical" value={tab} onValueChange={(v) => setTab(String(v))} className="min-h-0 flex-1 flex-col gap-0 sm:flex-row">
          <ScrollArea className="shrink-0 border-b border-border/60 sm:w-56 sm:border-b-0 sm:border-r dark:border-white/[0.08]" viewportClassName="max-h-[min(70dvh,34rem)]">
            <TabsList variant="line" className="h-auto w-full flex-col items-stretch gap-1 p-2.5" aria-label="Settings sections">
              <RailLabel first>Integrations</RailLabel>
              {sources === null &&
                [88, 64, 72, 96, 80, 56].map((w, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-3 py-2" aria-hidden="true">
                    <Skeleton className="size-4 rounded" />
                    <Skeleton className="h-3.5" style={{ width: w }} />
                  </div>
                ))}
              {(sources ?? []).map((s) => {
                const found = s.locations.filter((l) => l.exists).length;
                return (
                  <TabsTrigger key={s.provider} value={s.provider} className={RAIL_TAB}>
                    <ProviderLogo provider={s.provider} className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-left">{s.name}</span>
                    {s.enabled ? (
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          found ? "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]" : "bg-muted-foreground/30",
                        )}
                        aria-label={found ? "On, found on this PC" : "On, nothing found"}
                      />
                    ) : (
                      <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Off
                      </span>
                    )}
                  </TabsTrigger>
                );
              })}
              <RailLabel>General</RailLabel>
              <TabsTrigger value="appearance" className={RAIL_TAB}>
                <Palette className="size-4 shrink-0" strokeWidth={1.5} /> Appearance
              </TabsTrigger>
            </TabsList>
          </ScrollArea>

          <ScrollArea className="min-h-0 min-w-0 flex-1" viewportClassName="max-h-[min(70dvh,34rem)]">
            <div className="p-6">
              {/* Appearance Tab */}
              <TabsContent value="appearance">
                <PanelHeader
                  icon={<Palette className="size-5" strokeWidth={1.75} />}
                  title="Appearance"
                  hint="Customize the visual theme and readability."
                />

                <div className="space-y-4">
                  <div>
                    <h4 className="font-sans text-[14px] font-semibold text-foreground">Theme</h4>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">Select how ChatVault displays interfaces and colors.</p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {/* Dark Mode Card */}
                    <button
                      type="button"
                      onClick={() => onSetDark?.(true)}
                      className={cn(
                        "group flex cursor-pointer flex-col rounded-xl border p-4 text-left transition-all",
                        dark
                          ? "border-amber-500 bg-amber-500/10 shadow-xs ring-1 ring-amber-500"
                          : "border-border bg-card hover:border-border/80 hover:bg-muted/50 dark:border-white/10 dark:bg-[#16181a]",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex size-8 items-center justify-center rounded-lg bg-neutral-900 text-[#f0a83c] border border-neutral-700">
                          <Moon className="size-4" strokeWidth={2} />
                        </div>
                        {dark && (
                          <span className="flex size-5 items-center justify-center rounded-full bg-[#f0a83c] text-[#120d04]">
                            <Check className="size-3" strokeWidth={3} />
                          </span>
                        )}
                      </div>
                      <div className="mt-3">
                        <span className="font-sans text-[14px] font-semibold text-foreground group-hover:text-amber-600 dark:group-hover:text-[#f0a83c]">
                          Dark Mode
                        </span>
                        <p className="mt-0.5 text-[12px] text-muted-foreground leading-relaxed">
                          Warm amber accents on charcoal surfaces. High contrast and easy on the eyes.
                        </p>
                      </div>
                    </button>

                    {/* Light Mode Card */}
                    <button
                      type="button"
                      onClick={() => onSetDark?.(false)}
                      className={cn(
                        "group flex cursor-pointer flex-col rounded-xl border p-4 text-left transition-all",
                        !dark
                          ? "border-amber-500 bg-amber-500/10 shadow-xs ring-1 ring-amber-500"
                          : "border-border bg-card hover:border-border/80 hover:bg-muted/50 dark:border-white/10 dark:bg-[#16181a]",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex size-8 items-center justify-center rounded-lg bg-white text-amber-600 border border-neutral-200 shadow-xs">
                          <Sun className="size-4" strokeWidth={2} />
                        </div>
                        {!dark && (
                          <span className="flex size-5 items-center justify-center rounded-full bg-[#f0a83c] text-[#120d04]">
                            <Check className="size-3" strokeWidth={3} />
                          </span>
                        )}
                      </div>
                      <div className="mt-3">
                        <span className="font-sans text-[14px] font-semibold text-foreground group-hover:text-amber-600 dark:group-hover:text-[#f0a83c]">
                          Light Mode
                        </span>
                        <p className="mt-0.5 text-[12px] text-muted-foreground leading-relaxed">
                          Crisp white cards with WCAG AAA contrast ratio (&gt;7:1) for optimal daylight reading.
                        </p>
                      </div>
                    </button>
                  </div>
                </div>
              </TabsContent>

              {sources === null && tab !== "appearance" && (
                <div aria-hidden="true">
                  <div className="mb-4 flex items-center gap-3">
                    <Skeleton className="size-10 rounded-xl" />
                    <div className="space-y-1.5">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-3 w-44" />
                    </div>
                  </div>
                  <div className="space-y-2.5">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="space-y-2 rounded-xl border border-border p-3.5">
                        <div className="flex items-center gap-2">
                          <Skeleton className="h-4 w-20" />
                          <Skeleton className="h-4 w-12 rounded-full" />
                          <Skeleton className="h-3.5 w-24" />
                        </div>
                        <Skeleton className="h-3.5 w-4/5" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(sources ?? []).map((s) => {
                const found = s.locations.filter((l) => l.exists).length;
                const chats = s.locations.reduce((n, l) => n + (l.exists ? (l.items ?? 0) : 0), 0);
                return (
                  <TabsContent key={s.provider} value={s.provider}>
                    <PanelHeader
                      icon={<ProviderLogo provider={s.provider} className="size-5" />}
                      title={s.name}
                      hint={
                        !s.enabled
                          ? "Switched off"
                          : found === 0
                            ? "Nothing found on this PC."
                            : `${found} of ${s.locations.length} ${s.locations.length === 1 ? "place" : "places"} found${chats ? ` · ${chats.toLocaleString()} chats counted` : ""}`
                      }
                      action={
                        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[13px] font-medium text-foreground">
                          {switching === s.provider ? <Loader2 className="size-3.5 animate-spin" /> : s.enabled ? "On" : "Off"}
                          <Switch
                            checked={s.enabled}
                            disabled={switching !== null}
                            onCheckedChange={(v) => void toggle(s, v)}
                            aria-label={`${s.enabled ? "Switch off" : "Switch on"} ${s.name}`}
                          />
                        </label>
                      }
                    />

                    {!s.enabled && (
                      <div role="status" className="mb-4 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5 text-[12px] text-amber-950 dark:text-[#f0a83c]">
                        <Info className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-[#f0a83c]" strokeWidth={1.75} />
                        <p className="leading-relaxed">
                          <strong className="font-semibold">{s.name} is switched off.</strong> Its chats are not listed, counted or backed up. Nothing is deleted, and turning it back on brings everything back instantly.
                        </p>
                      </div>
                    )}

                    <div className={cn("space-y-2.5", !s.enabled && "opacity-60")}>
                      {s.locations.map((l) => (
                        <LocationCard key={`${l.label}:${l.path}`} loc={l} onOpen={() => openPlace(l.path)} />
                      ))}
                    </div>

                    {s.provider === "imported" && s.enabled && (
                      <div className="mt-4 space-y-2.5 rounded-xl border border-border bg-card p-4 shadow-xs dark:border-white/[0.08] dark:bg-[#16181a]">
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" className="cursor-pointer shadow-xs" disabled={importing} onClick={() => void runImport(false)}>
                            {importing ? <Loader2 className="size-3.5 animate-spin" /> : <FilePlus2 className="size-3.5" strokeWidth={1.5} />}
                            Import files…
                          </Button>
                          <Button variant="outline" size="sm" className="cursor-pointer shadow-xs" disabled={importing} onClick={() => void runImport(true)}>
                            {importing ? <Loader2 className="size-3.5 animate-spin" /> : <FolderOpen className="size-3.5" strokeWidth={1.5} />}
                            Import folder…
                          </Button>
                        </div>
                        <p className="text-[12px] leading-relaxed text-muted-foreground">
                          Drop files into the folder above, or pick them here. JSON is preferred. ChatGPT, Gemini and Grok are listed as separate platforms. Duplicates are skipped.
                        </p>
                      </div>
                    )}
                  </TabsContent>
                );
              })}

              {/* Local & Private note */}
              <div
                role="note"
                className="mt-6 flex items-start gap-3 rounded-xl border border-border/80 bg-muted/30 p-3.5 text-[12px] text-muted-foreground dark:border-white/[0.06] dark:bg-white/[0.02]"
              >
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="size-3.5" strokeWidth={2} />
                </div>
                <p className="leading-relaxed">
                  <strong className="font-semibold text-foreground">100% Local &amp; Private:</strong> ChatVault reads these locations directly on your machine. Nothing is ever uploaded to the cloud, and files remain completely untouched unless you delete a conversation yourself.
                </p>
              </div>
            </div>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
