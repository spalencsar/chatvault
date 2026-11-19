import type { ReactNode } from "react";
import { Archive, Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProviderLogo, visualProvider } from "@/claude-logo";
import { sourceGlyph } from "@/source-icons";
import { ContextArea, type Entry } from "@/context-area";
import { accountLabel, prettyTitle, PROVIDER_NAME, type Chat } from "@/chat-actions";

/** "Today · 10:42", "Yesterday · 18:27" or "Jan 13 · 21:10" — the compact stamp used on the cards. */
const cardTime = (ms: number) => {
  const d = new Date(ms);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const day =
    d.toDateString() === now.toDateString()
      ? "Today"
      : d.toDateString() === yesterday.toDateString()
        ? "Yesterday"
        : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${day} · ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
};

function FormattedPreview({ text }: { text: string }) {
  // If preview contains inline code wrapped in backticks or code terms, highlight them softly like the mockup
  if (!text.includes("`")) {
    return <span className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground/80">{text}</span>;
  }
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <span className="line-clamp-2 text-[13px] leading-relaxed text-muted-foreground/80">
      {parts.map((part, idx) => {
        if (part.startsWith("`") && part.endsWith("`")) {
          return (
            <code key={idx} className="rounded bg-white/[0.08] px-1 py-0.5 font-mono text-[11.5px] text-foreground/90">
              {part.slice(1, -1)}
            </code>
          );
        }
        return part;
      })}
    </span>
  );
}

/**
 * One chat as a card: title with a star, source and time, and a two-line preview of the conversation.
 * `menu` is the three-dots button (it fades in on hover), `entries` the right-click menu.
 */
export function ChatCard({
  chat,
  title,
  selected,
  pinned,
  live,
  hit,
  menu,
  entries,
  onError,
  onOpen,
  onUnpin,
}: {
  chat: Chat;
  title?: string;
  selected?: boolean;
  pinned?: boolean;
  live?: boolean;
  hit?: string;
  /** Kept for the project-grouped list; the card itself no longer repeats the project name. */
  inProject?: boolean;
  menu?: ReactNode;
  entries?: () => Entry[];
  onError?: (e: unknown) => void;
  onOpen: () => void;
  onUnpin?: () => void;
}) {
  const logoProvider = visualProvider(chat.provider, chat.account);
  const source = chat.provider === "imported" ? accountLabel(chat.account) : PROVIDER_NAME[chat.provider];
  // The search hit wins over the indexed first-message preview.
  const preview = hit ?? chat.preview;
  const card = (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.target === e.currentTarget && e.key === "Enter" && onOpen()}
      className={cn(
        "group w-full cursor-pointer rounded-xl border px-4 py-3.5 text-left shadow-xs transition-colors",
        selected
          ? "border-amber-500 bg-amber-500/15 dark:border-[#f0a83c] dark:bg-[#272119]"
          : "border-border bg-card hover:bg-muted/60 dark:border-white/[0.06] dark:bg-[#1a1c1e] dark:hover:border-white/[0.12] dark:hover:bg-[#202327]",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 truncate font-sans text-[15px] font-semibold leading-snug text-foreground" title={prettyTitle(title ?? chat.title)}>
          {prettyTitle(title ?? chat.title)}
        </span>
        {pinned &&
          (onUnpin ? (
            <button
              type="button"
              aria-label="Unstar chat"
              title="Unstar chat"
              className="-mt-0.5 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded focus-visible:outline-2 focus-visible:outline-ring"
              onClick={(e) => {
                e.stopPropagation();
                onUnpin();
              }}
            >
              <Bookmark className="size-4 fill-[#f0a83c] text-[#f0a83c]" />
            </button>
          ) : (
            <Bookmark className="size-4 shrink-0 fill-[#f0a83c] text-[#f0a83c]" />
          ))}
        {menu}
      </div>

      <div className="mt-2.5 flex items-center gap-2 text-[13px] text-muted-foreground">
        <span className="relative flex size-3.5 shrink-0 items-center justify-center">
          {sourceGlyph(logoProvider, "size-3.5") ?? <ProviderLogo provider={logoProvider} className="size-3.5 grayscale" />}
          {live && (
            <span className="absolute -right-1 -top-1 size-1.5 rounded-full bg-emerald-500 ring-1 ring-card dark:ring-[#1a1c1e]" aria-label="An agent is working in this chat" />
          )}
        </span>
        <span className={cn("min-w-0 truncate font-normal", logoProvider === "opencode" && "text-[#f0a83c]")}>{source}</span>
        <span className="ml-auto shrink-0 tabular-nums text-muted-foreground/80">{cardTime(chat.lastMs)}</span>
        {(chat.archived || chat.backup) && <Archive className="size-3.5 shrink-0" strokeWidth={1.5} />}
      </div>

      {preview && (
        <div className="mt-2">
          <FormattedPreview text={preview} />
        </div>
      )}
    </div>
  );
  return entries ? (
    <ContextArea entries={entries} onError={onError}>
      {card}
    </ContextArea>
  ) : (
    card
  );
}
