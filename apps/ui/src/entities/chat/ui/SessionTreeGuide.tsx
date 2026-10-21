/** Shared connected guides for the sidebar and the composer's runtime tree. */
export function TreeGuide({
  prefixCols,
  depth,
  isLast,
}: {
  prefixCols: readonly boolean[]
  depth: number
  isLast: boolean
}) {
  if (depth === 0) return null
  return (
    <span aria-hidden className="flex shrink-0 self-stretch">
      {prefixCols.map((hasLine, i) => (
        <span key={i} className="relative w-5">
          {hasLine && <span className="absolute inset-y-0 left-1/2 w-px bg-control-border/45" />}
        </span>
      ))}
      <span className="relative w-5">
        <span
          className={[
            'absolute left-1/2 w-px bg-control-border/55',
            isLast ? 'top-0 h-1/2' : 'inset-y-0',
          ].join(' ')}
        />
        <span className="absolute left-1/2 top-1/2 h-px w-1/2 bg-control-border/55" />
      </span>
    </span>
  )
}
