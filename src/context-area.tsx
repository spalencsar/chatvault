import { useState, type ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuGroup,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

/** One line of a right-click menu. Menus are described as data so every window can build its own list. */
export type Entry =
  | { type: "item"; label: string; icon?: ReactNode; hint?: string; onSelect: () => void | Promise<void>; danger?: boolean; muted?: boolean; disabled?: boolean }
  | { type: "check"; label: string; icon?: ReactNode; checked: boolean; onSelect: () => void }
  | { type: "sub"; label: string; icon?: ReactNode; entries: Entry[] }
  | { type: "label"; label: string }
  | { type: "sep" };

/** Drops separators that would sit first, last or twice in a row, so menus built from optional parts never look broken. */
function tidy(list: Entry[]): Entry[] {
  const out: Entry[] = [];
  for (const e of list) {
    if (e.type === "sep" && (!out.length || out[out.length - 1].type === "sep")) continue;
    out.push(e);
  }
  while (out.length && out[out.length - 1].type === "sep") out.pop();
  return out;
}

function Lines({ entries, onError }: { entries: Entry[]; onError: (e: unknown) => void }) {
  return (
    <>
      {tidy(entries).map((e, i) => {
        if (e.type === "sep") return <ContextMenuSeparator key={i} />;
        // A label must sit inside a group, or Base UI throws and the whole window goes blank.
        if (e.type === "label")
          return (
            <ContextMenuGroup key={i}>
              <ContextMenuLabel>{e.label}</ContextMenuLabel>
            </ContextMenuGroup>
          );
        if (e.type === "sub")
          return (
            <ContextMenuSub key={i}>
              <ContextMenuSubTrigger>
                {e.icon}
                {e.label}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent className="w-52">
                <Lines entries={e.entries} onError={onError} />
              </ContextMenuSubContent>
            </ContextMenuSub>
          );
        if (e.type === "check")
          return (
            <ContextMenuCheckboxItem key={i} checked={e.checked} onClick={e.onSelect}>
              {e.icon}
              {e.label}
            </ContextMenuCheckboxItem>
          );
        return (
          <ContextMenuItem key={i} variant={e.danger ? "destructive" : "default"} className={e.muted ? "opacity-50" : undefined} disabled={e.disabled} onClick={() => void Promise.resolve(e.onSelect()).catch(onError)}>
            {e.icon}
            {e.label}
          </ContextMenuItem>
        );
      })}
    </>
  );
}

/**
 * Right-click menu for an area of the app. `entries` is asked for the list each time the menu opens and is told what was
 * clicked, so one area can offer different things for a message, a picture or empty space. The innermost area wins.
 */
export function ContextArea({
  entries,
  onError,
  className,
  children,
}: {
  entries: (target: HTMLElement) => Entry[];
  onError?: (e: unknown) => void;
  className?: string;
  children: ReactNode;
}) {
  const [list, setList] = useState<Entry[]>([]);
  return (
    <ContextMenu>
      <ContextMenuTrigger
        className={cn("select-text", className)}
        onContextMenu={(ev: React.MouseEvent) => {
          // A text field keeps the normal copy and paste menu.
          const t = ev.target as HTMLElement;
          if (t.closest("input, textarea, [contenteditable=true]")) return;
          ev.stopPropagation();
          setList(entries(t));
        }}
      >
        {children}
      </ContextMenuTrigger>
      {tidy(list).length > 0 && (
        <ContextMenuContent className="w-56">
          <Lines entries={list} onError={onError ?? (() => {})} />
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}

