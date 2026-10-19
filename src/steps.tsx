import { memo } from "react";
import { useStickyOpen } from "@/sticky-open";
import { Bot, Brain, CircleCheck, CircleDashed, Circle, Globe, ListTodo, Terminal as TerminalIcon, Wrench, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import { Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceIcon, TraceLine, TraceTitle } from "@/components/ui/trace";
import { isFilePath, useFileView } from "@/file-viewer";
import { Highlight, textHas } from "@/highlight";
import { ColoredOutput, ShellLine, guessLanguage } from "@/shell-highlight";
import { hostname, uniqueUrls } from "@/ai-elements";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Msg } from "@/chat-actions";

export type Item = Msg & { result?: Msg };

/** Attaches every tool result to its call and drops the separate result messages. */
export function mergeResults(msgs: Msg[]): Item[] {
  const results = new Map<string, Msg>();
  for (const m of msgs) if (m.kind === "result" && m.id) results.set(m.id, m);
  return msgs.filter((m) => m.kind !== "result").map((m) => (m.kind === "tool" && m.id && results.has(m.id) ? { ...m, result: results.get(m.id) } : m));
}

const SHELL = /^(bash|shell|exec_command|powershell|local_shell|shell_command|exec)$/i;
export const isPlan = (m: Item) => m.kind === "tool" && (m.name === "TodoWrite" || m.name === "update_plan");
export const isAgent = (m: Item) => m.kind === "tool" && (m.name === "Task" || m.name === "Agent");
const isShell = (m: Item) => m.kind === "tool" && !!m.name && SHELL.test(m.name);
const isWeb = (m: Item) => m.kind === "tool" && (m.name === "WebFetch" || m.name === "WebSearch");

const str = (v: unknown) => (typeof v === "string" ? v : Array.isArray(v) ? v.join(" ") : "");
const data = (m: Item) => (m.data ?? {}) as Record<string, unknown>;
const clipText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function splitText(text: string) {
  const k = text.indexOf(": ");
  return k > 0 ? [text.slice(0, k), text.slice(k + 2)] : [text, ""];
}

export const stepName = (m: Item) => m.name ?? (m.kind === "reasoning" ? "Thought" : splitText(m.text)[0]);

type PlanStep = { text: string; status: "done" | "running" | "pending" };

function planSteps(m: Item): PlanStep[] {
  const d = data(m);
  const norm = (s: unknown): PlanStep["status"] => (s === "completed" ? "done" : s === "in_progress" ? "running" : "pending");
  const todos = d.todos as { content?: string; status?: string }[] | undefined;
  const plan = d.plan as { step?: string; status?: string }[] | undefined;
  if (todos) return todos.map((t) => ({ text: t.content ?? "", status: norm(t.status) }));
  if (plan) return plan.map((t) => ({ text: t.step ?? "", status: norm(t.status) }));
  return [];
}

/** The task list or plan the AI kept, with how far it got. */
export function PlanBlock({ item, memoKey }: { item: Item; memoKey?: string }) {
  const [open, setOpen] = useStickyOpen(memoKey, true);
  const steps = planSteps(item);
  if (!steps.length) return null;
  const done = steps.filter((s) => s.status === "done").length;
  const running = steps.some((s) => s.status === "running");
  return (
    <Trace className="pl-11">
      <TraceCollapsible open={open} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={running ? "running" : undefined}>
            <TraceIcon>
              <ListTodo />
            </TraceIcon>
            <TraceTitle>Plan</TraceTitle>
            <TraceDescription>
              {done} of {steps.length} done
            </TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <Trace>
            {steps.map((s, i) => (
              <TraceLine key={i} status={s.status === "running" ? "running" : s.status === "pending" ? "pending" : undefined}>
                <TraceIcon>{s.status === "done" ? <CircleCheck /> : s.status === "running" ? <CircleDashed /> : <Circle />}</TraceIcon>
                <TraceTitle className={s.status === "done" ? "line-through" : undefined}>{s.text}</TraceTitle>
              </TraceLine>
            ))}
          </Trace>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

/** A sub-agent run: what it was asked and what it reported back. */
export function SubagentBlock({ item, memoKey }: { item: Item; memoKey?: string }) {
  const [open, setOpen] = useStickyOpen(memoKey);
  const d = data(item);
  const title = str(d.description) || "Sub-agent";
  const kind = str(d.subagent_type);
  return (
    <Trace className="pl-11">
      <TraceCollapsible open={open} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger>
          <TraceLine status={item.result?.error ? "error" : undefined}>
            <TraceIcon>
              <Bot />
            </TraceIcon>
            <TraceTitle className="truncate">Ran agent: {title}</TraceTitle>
            {kind && <Badge variant="outline">{kind}</Badge>}
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="flex flex-col gap-3">
          {str(d.prompt) && (
            <CodeBlock size="sm">
              <CodeBlockContent data-lenis-prevent wrap className="max-h-48">
                {str(d.prompt)}
              </CodeBlockContent>
            </CodeBlock>
          )}
          {item.result?.text && (
            <CodeBlock size="sm">
              <CodeBlockContent data-lenis-prevent wrap className="max-h-64">
                {item.result.text}
              </CodeBlockContent>
            </CodeBlock>
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

/** One tool step inside an expanded group. */
export const StepItem = memo(function StepItem({ item, q, memoKey }: { item: Item; q: string; memoKey?: string }) {
  const [open, setOpen] = useStickyOpen(memoKey);
  const files = useFileView();
  const [name, detail] = splitText(item.text);
  const d0 = data(item);
  const filePath = [d0.file_path, d0.filePath, d0.path, d0.absolute_path, d0.target_file].map(str).find((x) => x && isFilePath(x)) ?? (isFilePath(detail) ? detail : "");

  if (item.kind === "reasoning") {
    return (
      <Trace>
        <TraceCollapsible open={open || (!!q && textHas(item.text, q))} onOpenChange={setOpen}>
          <TraceCollapsibleTrigger>
            <TraceLine>
              <TraceIcon>
                <Brain />
              </TraceIcon>
              <TraceTitle>Thought</TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent className="whitespace-pre-wrap text-sm">
            <Highlight text={item.text.trim()} q={q} activeMark={false} />
          </TraceCollapsibleContent>
        </TraceCollapsible>
      </Trace>
    );
  }

  if (isShell(item)) {
    const d = data(item);
    const cmd = str(d.command) || str(d.cmd) || detail;
    const out = item.result?.text ?? "";
    return (
      <Trace>
        <TraceCollapsible open={open} onOpenChange={setOpen}>
          <TraceCollapsibleTrigger>
            <TraceLine status={item.result?.error ? "error" : undefined}>
              <TraceIcon>
                <TerminalIcon />
              </TraceIcon>
              <TraceTitle className="truncate font-mono text-xs">
                Ran <ShellLine text={clipText(cmd.split("\n")[0], 90)} q={q} />
              </TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent>
            <CodeBlock size="sm">
              <CodeBlockContent data-lenis-prevent className="max-h-64">
                <span>
                  <span className="text-muted-foreground">$ </span>
                  <ShellLine text={cmd} />
                  {out ? "\n" : null}
                  {out ? <ColoredOutput code={out} language={guessLanguage(cmd)} /> : null}
                </span>
              </CodeBlockContent>
            </CodeBlock>
          </TraceCollapsibleContent>
        </TraceCollapsible>
      </Trace>
    );
  }

  if (isWeb(item)) {
    const d = data(item);
    const target = str(d.url) || str(d.query) || detail;
    const urls = Array.from(new Set([...(str(d.url) ? [str(d.url)] : []), ...uniqueUrls(item.result?.text ?? "")]));
    return (
      <Trace>
        <TraceCollapsible open={open} onOpenChange={setOpen}>
          <TraceCollapsibleTrigger>
            <TraceLine>
              <TraceIcon>
                <Globe />
              </TraceIcon>
              <TraceTitle className="truncate">
                {item.name === "WebSearch" ? "Searched" : "Fetched"} {clipText(item.name === "WebSearch" ? target : hostname(target), 70)}
              </TraceTitle>
              {urls.length > 0 && <TraceDescription>{urls.length} sources</TraceDescription>}
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent>
            <Trace>
              {urls.slice(0, 12).map((u) => (
                <a
                  key={u}
                  href={u}
                  onClick={(e) => {
                    e.preventDefault();
                    openUrl(u).catch(() => {});
                  }}
                >
                  <TraceLine>
                    <TraceIcon>
                      <Globe />
                    </TraceIcon>
                    <TraceTitle>{hostname(u)}</TraceTitle>
                    <TraceIcon>
                      <ArrowUpRight />
                    </TraceIcon>
                  </TraceLine>
                </a>
              ))}
            </Trace>
          </TraceCollapsibleContent>
        </TraceCollapsible>
      </Trace>
    );
  }

  return (
    <Trace>
      <TraceLine>
        <TraceIcon>
          <Wrench />
        </TraceIcon>
        <TraceTitle className="font-medium text-foreground/80">
          <Highlight text={name} q={q} activeMark={false} />
        </TraceTitle>
        {filePath ? (
          <button type="button" onClick={() => files.open(filePath)} className="min-w-0 cursor-pointer truncate text-left font-mono text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground">
            <Highlight text={filePath} q={q} activeMark={false} />
          </button>
        ) : (
          detail && (
            <TraceDescription className="truncate font-mono text-xs">
              <Highlight text={detail} q={q} activeMark={false} />
            </TraceDescription>
          )
        )}
      </TraceLine>
    </Trace>
  );
});
