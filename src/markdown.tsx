import { Children, isValidElement, memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { Cite } from "@/ai-elements";
import { Highlight, textHas } from "@/highlight";
import { isFilePath, useFileView } from "@/file-viewer";

const text = (node: ReactNode): string =>
  Children.toArray(node)
    .map((c) => (typeof c === "string" || typeof c === "number" ? String(c) : isValidElement(c) ? text((c.props as { children?: ReactNode }).children) : ""))
    .join("");

/**
 * Chat text rendered as GitHub-flavoured Markdown: headings, bold and italic, lists, task lists, quotes,
 * tables, rules and inline code. Links become inline citations and search matches stay highlighted.
 */
function MarkdownImpl({ source, q, active, breaks }: { source: string; q: string; active: boolean; breaks?: boolean }) {
  const files = useFileView();
  let taken = false;
  const hl = (children: ReactNode): ReactNode =>
    Children.map(children, (c) => {
      if (typeof c !== "string") return c;
      const has = !!q && textHas(c, q);
      const act = has && active && !taken;
      if (act) taken = true;
      return <Highlight text={c} q={q} activeMark={act} />;
    });

  const components: Components = {
    p: ({ children }) => <p className="leading-relaxed [&:not(:first-child)]:mt-3">{hl(children)}</p>,
    h1: ({ children }) => <h1 className="mb-2 mt-5 text-lg font-semibold leading-snug first:mt-0">{hl(children)}</h1>,
    h2: ({ children }) => <h2 className="mb-2 mt-5 text-base font-semibold leading-snug first:mt-0">{hl(children)}</h2>,
    h3: ({ children }) => <h3 className="mb-1.5 mt-4 text-sm font-semibold first:mt-0">{hl(children)}</h3>,
    h4: ({ children }) => <h4 className="mb-1 mt-3 text-sm font-medium first:mt-0">{hl(children)}</h4>,
    h5: ({ children }) => <h5 className="mb-1 mt-3 text-sm font-medium text-muted-foreground first:mt-0">{hl(children)}</h5>,
    h6: ({ children }) => <h6 className="mb-1 mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground first:mt-0">{hl(children)}</h6>,
    ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-muted-foreground [&_ul]:my-1 [&_ol]:my-1">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground [&_ul]:my-1 [&_ol]:my-1">{children}</ol>,
    li: ({ children }) => <li className="pl-0.5 leading-relaxed has-[input]:list-none has-[input]:-ml-5">{hl(children)}</li>,
    blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>,
    hr: () => <hr className="my-4 border-border" />,
    strong: ({ children }) => <strong className="font-semibold">{hl(children)}</strong>,
    em: ({ children }) => <em className="italic">{hl(children)}</em>,
    del: ({ children }) => <del className="text-muted-foreground">{hl(children)}</del>,
    a: ({ href, children }) => (href ? <Cite url={href} label={text(children)} /> : <>{hl(children)}</>),
    code: ({ children }) => {
      const t = text(children);
      if (isFilePath(t)) {
        return (
          <button type="button" onClick={() => files.open(t)} className="cursor-pointer rounded bg-muted px-1 py-0.5 text-left font-mono text-[0.85em] underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 hover:bg-accent hover:decoration-solid">
            {hl(children)}
          </button>
        );
      }
      return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] [pre_&]:bg-transparent [pre_&]:p-0">{hl(children)}</code>;
    },
    pre: ({ children }) => <pre className="my-2 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{children}</pre>,
    table: ({ children }) => (
      <div className="my-3 overflow-auto rounded-lg border">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
    th: ({ children }) => <th className="px-3 py-2 text-left font-medium">{hl(children)}</th>,
    td: ({ children }) => <td className="border-t px-3 py-2 align-top">{hl(children)}</td>,
    input: (props) => <input {...props} disabled className="mr-1.5 size-3.5 translate-y-0.5 accent-foreground" />,
    img: ({ alt }) => <span className="text-muted-foreground">[Image{alt ? `: ${alt}` : ""}]</span>,
  };

  return (
    <ReactMarkdown remarkPlugins={breaks ? [remarkGfm, remarkBreaks] : [remarkGfm]} components={components}>
      {source}
    </ReactMarkdown>
  );
}

/** Re-parsed only when its text or the search changes, not on every scroll frame. */
export const Markdown = memo(MarkdownImpl);
