import { ChevronRight, FolderOpen, LayoutDashboard, Loader2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { usePersisted } from "@/store";

export type WorkspaceRow = { project: string; count: number; cwd: string };
export type SourceSubItem = { id: string; label: string; count: number; active: boolean; logo: ReactNode };
export type SourceRow = {
  id: string;
  label: string;
  logo: ReactNode;
  count: number;
  active: boolean;
  subItems?: SourceSubItem[];
  onSelectSubItem?: (id: string) => void;
};

function SectionHeader({ open, label, onToggle }: { open: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center gap-1.5 px-1.5 pt-4 pb-2 text-[13px] font-semibold tracking-[0.1em] text-muted-foreground uppercase transition-colors hover:text-foreground"
    >
      <ChevronRight className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")} strokeWidth={2.5} />
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}

function Row({
  active,
  icon,
  label,
  count,
  title,
  trailing,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  count?: number;
  title?: string;
  trailing?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "relative flex h-12 w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 text-left text-[16px] transition-colors",
        active
          ? "bg-amber-100 text-amber-950 font-medium dark:bg-[#362c21] dark:text-foreground"
          : "text-foreground hover:bg-sidebar-accent",
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
      {count !== undefined && (
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[14px] tabular-nums",
            active
              ? "bg-amber-200/80 text-amber-950 font-medium dark:bg-[#624724] dark:text-[#f0c27a]"
              : "text-foreground/70",
          )}
        >
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}

/** The left navigation column: workspaces, sources, and the archive status. */
export function NavSidebar({
  workspaces,
  loadingWorkspaces,
  activeProject,
  activeCwd,
  onSelectProject,
  sources,
  onSelectSource,
  status,
  isDashboard,
  onSelectDashboard,
}: {
  workspaces: WorkspaceRow[];
  loadingWorkspaces: boolean;
  activeProject: string | null;
  activeCwd: string | null;
  onSelectProject: (w: WorkspaceRow | null) => void;
  sources: SourceRow[];
  onSelectSource: (id: string) => void;
  status?: ReactNode;
  isDashboard?: boolean;
  onSelectDashboard?: () => void;
}) {
  const [workspacesOpen, setWorkspacesOpen] = usePersisted("chatvault.nav.workspaces", true);
  const [sourcesOpen, setSourcesOpen] = usePersisted("chatvault.nav.sources", true);
  const [showAllWorkspaces, setShowAllWorkspaces] = useState(false);

  const visibleWorkspaces = useMemo(() => {
    if (showAllWorkspaces || workspaces.length <= 5) return workspaces;
    // Show top 5, but if the active workspace is further down, make sure it stays included
    const top = workspaces.slice(0, 5);
    const activeIdx = workspaces.findIndex((w) => w.project === activeProject && w.cwd === activeCwd);
    if (activeIdx >= 5) {
      top[4] = workspaces[activeIdx];
    }
    return top;
  }, [showAllWorkspaces, workspaces, activeProject, activeCwd]);

  return (
    <div className="flex min-h-0 w-[301px] flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {onSelectDashboard && (
          <div className="pt-2 pb-1">
            <Row
              active={!!isDashboard}
              icon={<LayoutDashboard className={cn("size-5", isDashboard ? "text-[#f0a83c]" : "text-foreground")} strokeWidth={1.5} />}
              label="Dashboard"
              onClick={onSelectDashboard}
            />
          </div>
        )}

        <SectionHeader open={workspacesOpen} label="Workspaces" onToggle={() => setWorkspacesOpen((o) => !o)} />
        {workspacesOpen && (
          <div className="space-y-0.5">
            {loadingWorkspaces && workspaces.length === 0 && (
              <div className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Loading…
              </div>
            )}
            {!loadingWorkspaces && workspaces.length === 0 && (
              <p className="px-2.5 py-2 text-xs text-muted-foreground">No workspaces yet.</p>
            )}
            {visibleWorkspaces.map((w) => {
              const active = !isDashboard && activeProject === w.project && activeCwd === w.cwd;
              return (
                <Row
                  key={`${w.project} ${w.cwd}`}
                  active={active}
                  icon={<FolderOpen className={cn("size-5", active ? "text-[#f0a83c]" : "text-foreground")} strokeWidth={1.5} />}
                  label={w.project}
                  count={w.count}
                  title={w.cwd}
                  onClick={() => onSelectProject(active ? null : w)}
                />
              );
            })}
            {workspaces.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAllWorkspaces((v) => !v)}
                className="mt-1 flex w-full cursor-pointer items-center justify-center rounded-md px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              >
                {showAllWorkspaces ? "Show fewer workspaces" : `Show all ${workspaces.length} workspaces…`}
              </button>
            )}
          </div>
        )}

        <SectionHeader open={sourcesOpen} label="Sources" onToggle={() => setSourcesOpen((o) => !o)} />
        {sourcesOpen && (
          <div className="space-y-0.5">
            {sources.map((s) => (
              <div key={s.id} className="space-y-0.5">
                <Row
                  active={!isDashboard && s.active && !s.subItems?.some((sub) => sub.active)}
                  icon={s.logo}
                  label={s.label}
                  count={s.count}
                  onClick={() => onSelectSource(s.id)}
                  trailing={
                    s.subItems && s.subItems.length > 0 ? (
                      <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground/60 transition-transform", !isDashboard && s.active && "rotate-90")} />
                    ) : undefined
                  }
                />
                {!isDashboard && s.active && s.subItems && s.subItems.length > 0 && (
                  <div className="ml-3 space-y-0.5 border-l border-border dark:border-white/[0.08] pl-2">
                    {s.subItems.map((sub) => (
                      <button
                        key={sub.id}
                        type="button"
                        onClick={() => s.onSelectSubItem?.(sub.id)}
                        className={cn(
                          "flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[14px] transition-colors",
                          sub.active
                            ? "bg-amber-100 text-amber-950 font-medium dark:bg-[#362c21] dark:text-[#f0a83c]"
                            : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                        )}
                      >
                        <span className="flex size-4 shrink-0 items-center justify-center">{sub.logo}</span>
                        <span className="min-w-0 flex-1 truncate">{sub.label}</span>
                        <span className={cn("shrink-0 text-[12px] tabular-nums", sub.active ? "text-amber-900 font-semibold dark:text-[#f0a83c]" : "text-muted-foreground/70")}>{sub.count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {status && <div className="flex h-12 shrink-0 items-center border-t border-border px-4 text-[13px] text-muted-foreground">{status}</div>}
    </div>
  );
}
