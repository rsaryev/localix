import { Skeleton } from '@localixai/kit/skeleton'

export function DocsSkeleton() {
  return (
    <div
      className="docs-skeleton"
      role="status"
      aria-label="Loading documentation"
      aria-busy="true"
    >
      <Skeleton className="mb-8 h-10 w-3/4" />
      <div className="mb-10 space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <Skeleton className="mb-6 h-6 w-1/2" />
      <div className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-full" />
      </div>
      <Skeleton className="mt-8 aspect-[8/5] w-full rounded-xl" />
      <span className="sr-only">Loading documentation…</span>
    </div>
  )
}
