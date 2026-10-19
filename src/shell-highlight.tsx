import { useEffect, useState, type ReactNode } from "react";
import { Highlight } from "@/highlight";
import { highlightCode } from "@/lib/highlighter";

type Kind = "cmd" | "flag" | "path" | "str" | "var" | "op" | "text";

const COLOR: Record<Kind, string> = {
  cmd: "font-medium text-violet-600 dark:text-violet-400",
  flag: "text-amber-600 dark:text-amber-400",
  path: "text-sky-600 dark:text-sky-400",
  str: "text-emerald-600 dark:text-emerald-400",
  var: "text-fuchsia-600 dark:text-fuchsia-400",
  op: "text-muted-foreground/60",
  text: "",
};

// Strings, variables, operators, spaces, then plain words, in the order they are tried.
const TOKEN = /("(?:[^"\\]|\\.)*"?|'[^']*'?)|(\$\{?\w+\}?|\$\()|(&&|\|\||\d?>>?&?\d?|[|;&<>()]+)|(\s+)|([^\s"'|;&<>()$]+)/g;
const PATH = /^(?:~|\.{1,2})?[\\/]|^[A-Za-z]:[\\/]|[\\/]|\.\w{1,6}$/;

/** Colours one line of a shell command: the command, flags, paths, strings and variables. */
export function ShellLine({ text, q = "" }: { text: string; q?: string }) {
  const out: { t: string; k: Kind }[] = [];
  let expectCmd = true;
  for (const m of text.matchAll(TOKEN)) {
    const [t, str, vr, op, ws] = m;
    if (str) out.push({ t, k: "str" });
    else if (vr) out.push({ t, k: "var" });
    else if (op) {
      out.push({ t, k: "op" });
      if (/[|;&(]/.test(t) && !/^\d?>/.test(t)) expectCmd = true;
    } else if (ws) out.push({ t, k: "text" });
    else if (/^--?[A-Za-z]/.test(t)) out.push({ t, k: "flag" });
    else if (expectCmd && !/^\w+=/.test(t) && !PATH.test(t)) {
      out.push({ t, k: "cmd" });
      expectCmd = false;
    } else {
      out.push({ t, k: PATH.test(t) ? "path" : "text" });
      if (!/^\w+=/.test(t)) expectCmd = false;
    }
  }
  return (
    <>
      {out.map((o, i) => (
        <span key={i} className={COLOR[o.k]}>
          <Highlight text={o.t} q={q} activeMark={false} />
        </span>
      ))}
    </>
  );
}

const BY_EXT: Record<string, string> = {
  tsx: "tsx",
  ts: "typescript",
  jsx: "jsx",
  js: "javascript",
  mjs: "javascript",
  json: "json",
  css: "css",
  html: "html",
  md: "markdown",
  py: "python",
  sql: "sql",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  diff: "diff",
};

/** Guesses the language of a command's output from the last file name it mentions. */
export function guessLanguage(cmd: string) {
  const hits = [...cmd.matchAll(/[\w./\\-]+\.(\w{1,5})(?=[\s"'|;&)]|$)/g)];
  for (let i = hits.length - 1; i >= 0; i--) {
    const lang = BY_EXT[hits[i][1].toLowerCase()];
    if (lang) return lang;
  }
  return null;
}

/** Command output coloured by its language once the highlighter has loaded; plain text until then. */
export function ColoredOutput({ code, language }: { code: string; language: string | null }) {
  const [lines, setLines] = useState<ReactNode[][] | null>(null);
  useEffect(() => {
    let live = true;
    setLines(null);
    // Very large outputs stay plain so opening a step never stalls the window.
    if (!language || code.length > 40000) return;
    highlightCode(code, language)
      .then((l) => live && setLines(l as ReactNode[][] | null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [code, language]);
  if (!lines) return <>{code}</>;
  return (
    <>
      {lines.map((l, i) => (
        <span key={i}>
          {l}
          {i < lines.length - 1 ? "\n" : null}
        </span>
      ))}
    </>
  );
}
