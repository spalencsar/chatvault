import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import {
  ExternalLink,
  FolderOpen,
  Info,
  Layers,
  Lock,
  RefreshCw,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { REPO_URL } from "@/made-with";
import { notifyError } from "@/toast";

const PRIVACY_SECTIONS = [
  {
    title: "1. 100% Local Execution & Zero Cloud",
    body: [
      "ChatVault is a purely local desktop application. There are no user accounts, no authentication servers, no telemetry, and no usage analytics. The maintainers do not operate any server that receives your conversations or data.",
      "All indexed data and files remain solely on your local computer.",
    ],
  },
  {
    title: "2. Read Locations & Read-Only Safety",
    body: [
      "To display your conversations, ChatVault reads the local storage directories and SQLite databases of supported AI tools installed on your computer (such as Claude Code, Codex, Cursor, Gemini CLI, OpenCode, Hermes Agent, Antigravity, and Grok).",
      "These third-party databases are opened strictly in read-only mode. ChatVault never alters or deletes records in source tool databases.",
      "The full-text search index is maintained inside a local SQLite database in ~/.local/share/chatvault.",
    ],
  },
  {
    title: "3. Local Archives & Snapshots",
    body: [
      "Successfully parsed conversations are saved atomically as normalized snapshots under ~/.local/share/chatvault/archive/. This ensures your conversation history remains preserved even if a source tool clears or compresses its own sessions.",
      "All exported files (Markdown, JSON capsules) and handoff files are saved directly to your local user directory.",
    ],
  },
  {
    title: "4. Network Communication",
    body: [
      "ChatVault does not transmit conversations, search terms, or snapshots over the internet. External links (such as project repositories or releases) open in your default system browser.",
    ],
  },
  {
    title: "5. User Control & Data Deletion",
    body: [
      "You maintain full ownership of all data. The local data directory (~/.local/share/chatvault) and backup folders can be inspected, moved, backed up, or deleted at any time through standard file tools.",
    ],
  },
];

const TERMS_SECTIONS = [
  {
    title: "1. MIT License & Project Origin",
    body: [
      "ChatVault is free and open-source software licensed under the MIT License.",
      "Originally created as a continuation derived from the Chat-Vault project by Sanaullah Rais, it has been comprehensively re-architected by Sebastian Palencsar into a Linux-first desktop workspace with deep multi-agent indexers, local snapshot archives, and accessible interfaces.",
      "Copyright (c) 2026 Sanaullah Rais",
      "Copyright (c) 2026 Sebastian Palencsar",
    ],
  },
  {
    title: "2. Tool Independence",
    body: [
      "ChatVault is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Anthropic, OpenAI, Google, Anysphere, Cursor, or any other provider. All product names, logos, and trademarks belong to their respective owners and are used strictly to identify local conversation sources.",
    ],
  },
  {
    title: "3. User Responsibility & Disclaimers",
    body: [
      "ChatVault is provided “as is”, without warranty of any kind. Users are solely responsible for protecting their local machines, managing credentials within conversations, and adhering to organizational policies and applicable laws.",
    ],
  },
];

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [version, setVersion] = useState("0.6.2");
  const [tab, setTab] = useState<string>("about");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  const openDataDir = () => {
    invoke("open_folder", { path: "~/.local/share/chatvault" }).catch(() => {
      invoke("open_chat_source", { path: "" }).catch(notifyError);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[min(90dvh,44rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        {/* Header */}
        <DialogHeader className="border-b border-border/70 px-6 py-4 dark:border-white/[0.08]">
          <div className="flex items-center gap-3.5">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-900 shadow-xs dark:bg-[#362c21] dark:text-[#f0a83c]">
              <Layers className="size-5" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <DialogTitle className="font-sans text-[20px] font-bold text-foreground">ChatVault</DialogTitle>
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-amber-950 dark:bg-[#624724] dark:text-[#f0c27a]">
                  v{version}
                </span>
              </div>
              <DialogDescription className="text-[13px] text-muted-foreground">
                Private, local-first workspace for your AI conversation history.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Tab Selection */}
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center border-b border-border/60 px-6 py-3 dark:border-white/[0.08]">
            <TabsList className="h-10 gap-2 bg-muted/60 p-1 dark:bg-[#16181a]">
              <TabsTrigger value="about" className="gap-2 cursor-pointer rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors data-active:bg-card data-active:text-foreground data-active:shadow-xs dark:data-active:bg-[#25282c] dark:data-active:text-[#f0a83c]">
                <Info className="size-3.5" /> About ChatVault
              </TabsTrigger>
              <TabsTrigger value="privacy" className="gap-2 cursor-pointer rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors data-active:bg-card data-active:text-foreground data-active:shadow-xs dark:data-active:bg-[#25282c] dark:data-active:text-[#f0a83c]">
                <ShieldCheck className="size-3.5" /> Privacy &amp; Security
              </TabsTrigger>
              <TabsTrigger value="terms" className="gap-2 cursor-pointer rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors data-active:bg-card data-active:text-foreground data-active:shadow-xs dark:data-active:bg-[#25282c] dark:data-active:text-[#f0a83c]">
                <ScrollText className="size-3.5" /> License &amp; Terms
              </TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="flex-1" viewportClassName="max-h-[min(65dvh,32rem)]">
            <div className="p-6">
              {/* Tab 1: About */}
              <TabsContent value="about" className="mt-0 space-y-6">
                <div>
                  <h3 className="font-sans text-[16px] font-bold text-foreground">
                    All your local AI chats in one central workspace
                  </h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                    ChatVault indexes, searches, backs up, and continues conversations across coding agents and CLI tools
                    directly on your Linux desktop — completely private, without cloud servers or accounts.
                  </p>
                </div>

                {/* 4 Architecture Pillars */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-border bg-card p-4 shadow-xs dark:border-white/[0.08] dark:bg-[#16181a]">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                        <ShieldCheck className="size-4" strokeWidth={2} />
                      </div>
                      <span className="font-sans text-[14px] font-semibold text-foreground">100% Offline &amp; Private</span>
                    </div>
                    <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                      Zero telemetry and zero external servers. Conversations never leave your local hardware.
                    </p>
                  </div>

                  <div className="rounded-xl border border-border bg-card p-4 shadow-xs dark:border-white/[0.08] dark:bg-[#16181a]">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-900 dark:bg-[#362c21] dark:text-[#f0a83c]">
                        <Lock className="size-4" strokeWidth={2} />
                      </div>
                      <span className="font-sans text-[14px] font-semibold text-foreground">Read-Only Safety</span>
                    </div>
                    <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                      Databases from Hermes, Antigravity, OpenCode, Codex, and Claude are opened strictly read-only.
                    </p>
                  </div>

                  <div className="rounded-xl border border-border bg-card p-4 shadow-xs dark:border-white/[0.08] dark:bg-[#16181a]">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                        <Layers className="size-4" strokeWidth={2} />
                      </div>
                      <span className="font-sans text-[14px] font-semibold text-foreground">Atomic Snapshots</span>
                    </div>
                    <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                      Normalized JSON snapshots under <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">~/.local/share/chatvault/archive</code> keep your history preserved permanently.
                    </p>
                  </div>

                  <div className="rounded-xl border border-border bg-card p-4 shadow-xs dark:border-white/[0.08] dark:bg-[#16181a]">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
                        <RefreshCw className="size-4" strokeWidth={2} />
                      </div>
                      <span className="font-sans text-[14px] font-semibold text-foreground">Handoffs &amp; Workspaces</span>
                    </div>
                    <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                      Hand off chats to continue in other agent tools, and organize sessions cleanly by workspace.
                    </p>
                  </div>
                </div>

                {/* Storage & Code Actions */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-muted/40 p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
                  <div className="min-w-0">
                    <span className="font-sans text-[13px] font-semibold text-foreground">Local Data Directory</span>
                    <p className="mt-0.5 font-mono text-[12px] text-muted-foreground select-all">~/.local/share/chatvault</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="cursor-pointer gap-2 shadow-xs"
                      onClick={openDataDir}
                    >
                      <FolderOpen className="size-3.5" /> Open folder
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="cursor-pointer gap-2 shadow-xs"
                      onClick={() => void openUrl(REPO_URL)}
                    >
                      <ExternalLink className="size-3.5" /> GitHub
                    </Button>
                  </div>
                </div>
              </TabsContent>

              {/* Tab 2: Privacy */}
              <TabsContent value="privacy" className="mt-0 space-y-6">
                <div>
                  <h3 className="font-sans text-[16px] font-bold text-foreground">Privacy Policy</h3>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    How ChatVault protects your data through local-first architecture.
                  </p>
                </div>

                <div className="space-y-5">
                  {PRIVACY_SECTIONS.map((sec) => (
                    <section key={sec.title} className="rounded-xl border border-border bg-card p-4 shadow-xs dark:border-white/[0.08] dark:bg-[#16181a]">
                      <h4 className="font-sans text-[14px] font-semibold text-foreground">{sec.title}</h4>
                      <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-muted-foreground">
                        {sec.body.map((p, i) => (
                          <p key={i}>{p}</p>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </TabsContent>

              {/* Tab 3: Terms & License */}
              <TabsContent value="terms" className="mt-0 space-y-6">
                <div>
                  <h3 className="font-sans text-[16px] font-bold text-foreground">License &amp; Terms</h3>
                  <p className="mt-1 text-[13px] text-muted-foreground">
                    ChatVault is open source under the MIT License.
                  </p>
                </div>

                <div className="space-y-5">
                  {TERMS_SECTIONS.map((sec) => (
                    <section key={sec.title} className="rounded-xl border border-border bg-card p-4 shadow-xs dark:border-white/[0.08] dark:bg-[#16181a]">
                      <h4 className="font-sans text-[14px] font-semibold text-foreground">{sec.title}</h4>
                      <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-muted-foreground">
                        {sec.body.map((p, i) => (
                          <p key={i}>{p}</p>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
