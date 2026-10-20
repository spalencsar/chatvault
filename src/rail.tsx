import type { ReactNode } from "react";

/** The look of one entry in the vertical tab list at the left of Settings and Sync & backup. */
export const RAIL_TAB =
  "h-auto w-full flex-none justify-start gap-2.5 rounded-md border-transparent px-2.5 py-2 text-sm font-normal text-muted-foreground after:hidden hover:text-foreground focus-visible:ring-1 data-active:bg-muted data-active:font-medium data-active:text-foreground data-active:shadow-none dark:data-active:border-transparent dark:data-active:bg-muted";

/** A small heading above the entries of the vertical tab list. */
export function RailLabel({ children, first }: { children: ReactNode; first?: boolean }) {
  return <p className={`px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70 ${first ? "pt-1" : "pt-3"}`}>{children}</p>;
}

/** The top of a tab's panel: an icon box, a title, a line of help and, optionally, an action at the right. */
export function PanelHeader({ icon, title, hint, action }: { icon: ReactNode; title: string; hint: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">{icon}</div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium leading-tight">{title}</h3>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {action}
    </div>
  );
}
