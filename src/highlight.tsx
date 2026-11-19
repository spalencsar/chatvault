import { cn } from "@/lib/utils";

/** Lower-cases and flattens quotes, dashes and spacing, so pasted text still matches. */
export function norm(s: string) {
  return s
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export const textHas = (text: string, q: string) => !!q && norm(text).includes(norm(q));

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A pattern that finds the query in the original text, whatever quote style or spacing it uses. */
function pattern(q: string) {
  return norm(q)
    .split("")
    .map((c) => {
      if (c === "'") return "['\u2018\u2019\u201B]";
      if (c === '"') return '["\u201C\u201D]';
      if (c === "-") return "[-\u2013\u2014]";
      if (c === " ") return "\\s+";
      return escapeRe(c);
    })
    .join("");
}

/** Wraps every match of the in-chat search in a highlight. */
export function Highlight({ text, q, activeMark }: { text: string; q: string; activeMark: boolean }) {
  if (!norm(q)) return <>{text}</>;
  const parts = text.split(new RegExp(`(${pattern(q)})`, "ig"));
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 0 ? (
          <span key={i}>{p}</span>
        ) : (
          <mark
            key={i}
            className={cn(
              "rounded-[3px] px-1 font-medium [box-decoration-break:clone] transition-colors",
              activeMark && i === 1
                ? "bg-amber-400 text-amber-950 shadow-[0_0_10px_rgba(245,158,11,0.5)] dark:bg-[#f0a83c] dark:text-[#18120c] dark:shadow-[0_0_10px_rgba(240,168,60,0.6)]"
                : "bg-amber-200/80 text-amber-950 dark:bg-amber-500/25 dark:text-amber-200",
            )}
          >
            {p}
          </mark>
        ),
      )}
    </>
  );
}
