import { Skeleton } from "@/components/ui/skeleton";

const W = ["w-3/4", "w-2/3", "w-5/6", "w-1/2", "w-4/5", "w-3/5"];

/** One chat row: logo box, title, project and date. */
export function ChatRowSkeleton({ i = 0 }: { i?: number }) {
  return (
    <div className="flex items-start gap-2.5 px-2.5 py-2">
      <Skeleton className="mt-0.5 size-8 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-1.5 py-0.5">
        <Skeleton className={`h-3.5 ${W[i % W.length]}`} />
        <div className="flex items-center gap-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="size-1 rounded-full" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    </div>
  );
}

export function SidebarSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-0.5" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <ChatRowSkeleton key={i} i={i} />
      ))}
    </div>
  );
}

/** One message: avatar, name and time, then the text. Your own messages sit on the right. */
function MessageSkeleton({ right, lines }: { right?: boolean; lines: number }) {
  return (
    <div className={`flex items-start gap-3 ${right ? "flex-row-reverse" : ""}`}>
      <Skeleton className="size-8 shrink-0 rounded-full" />
      <div className={`min-w-0 space-y-2 ${right ? "flex w-[55%] flex-col items-end" : "flex-1"}`}>
        <div className={`flex items-center gap-2 ${right ? "flex-row-reverse" : ""}`}>
          <Skeleton className="h-3.5 w-12" />
          <Skeleton className="h-3 w-14" />
        </div>
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className={`h-3.5 ${right ? (i === lines - 1 && lines > 1 ? "w-1/2" : "w-full") : i === lines - 1 ? "w-2/5" : i % 2 ? "w-11/12" : "w-full"}`} />
        ))}
      </div>
    </div>
  );
}

/** A collapsed run of steps, like the Trace line. */
function StepsSkeleton() {
  return (
    <div className="flex items-center gap-2 pl-11">
      <Skeleton className="size-4 rounded" />
      <Skeleton className="h-3.5 w-16" />
      <Skeleton className="h-3.5 w-44" />
    </div>
  );
}

/** Messages while a chat is loading. Same width and spacing as the real conversation. */
export function MessagesSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-7 px-4 pb-24 pt-4" aria-busy="true">
      <MessageSkeleton right lines={2} />
      <StepsSkeleton />
      <MessageSkeleton lines={5} />
      <MessageSkeleton right lines={3} />
      <StepsSkeleton />
      <MessageSkeleton lines={4} />
    </div>
  );
}

/** The chat header while a chat is loading: logo box, title with badges, toggles and Actions. */
export function HeaderSkeleton() {
  return (
    <div className="border-b py-3" aria-busy="true">
      <div className="w-full px-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-64 max-w-full" />
            <div className="flex flex-wrap gap-1">
              <Skeleton className="h-5 w-24 rounded-md" />
              <Skeleton className="h-5 w-28 rounded-md" />
              <Skeleton className="h-5 w-16 rounded-md" />
              <Skeleton className="h-5 w-24 rounded-md" />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Skeleton className="size-8 rounded-lg" />
            <Skeleton className="size-8 rounded-lg" />
            <Skeleton className="size-8 rounded-lg" />
          </div>
          <Skeleton className="h-8 w-24 shrink-0 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export function StatSkeleton() {
  return <Skeleton className="h-4 w-12" />;
}
