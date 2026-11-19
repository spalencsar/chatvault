import type { ReactNode } from "react";

/** The look of one entry in the vertical tab list at the left of Settings and Sync & backup. */
export const RAIL_TAB =
  "h-auto w-full flex-none cursor-pointer justify-start gap-2.5 rounded-lg border-transparent px-3 py-2 text-sm font-normal text-muted-foreground after:hidden transition-all hover:bg-muted/60 hover:text-foreground focus-visible:ring-1 data-active:bg-amber-100 data-active:font-semibold data-active:text-amber-950 data-active:shadow-none dark:data-active:border-transparent dark:data-active:bg-[#362c21] dark:data-active:text-[#f0a83c]";

/** A small heading above the entries of the vertical tab list. */
export function RailLabel({ children, first }: { children: ReactNode; first?: boolean }) {
  return <p className={`px-3 pb-1.5 text-[11px] font-semibold tracking-wider uppercase text-muted-foreground/75 ${first ? "pt-1" : "pt-4"}`}>{children}</p>;
}

/** The top of a tab's panel: an icon box, a title, a line of help and, optionally, an action at the right. */
export function PanelHeader({ icon, title, hint, action }: { icon: ReactNode; title: string; hint: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-center gap-3.5 border-b border-border/60 pb-4 dark:border-white/[0.06]">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-900 dark:bg-[#362c21] dark:text-[#f0a83c] shadow-xs">{icon}</div>
      <div className="min-w-0 flex-1">
        <h3 className="font-sans text-[16px] font-semibold leading-snug text-foreground">{title}</h3>
        <p className="text-[12px] text-muted-foreground">{hint}</p>
      </div>
      {action}
    </div>
  );
}
