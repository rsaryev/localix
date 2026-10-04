/**
 * DetailField — one `label: value` row for the compact key/value detail grids the
 * workbench center tabs share (Docker container, Kubernetes pod/resource). The value
 * truncates; the label stays fixed-width. One source of truth so the two workbenches
 * render their header facts identically. Wrap several in a `grid` for the columns.
 */
export function DetailField({
  label,
  value,
  title,
}: {
  label: string
  value: string
  /** Hover text for the value; defaults to the value itself, which the cell truncates. */
  title?: string
}) {
  return (
    <div className="flex min-w-0 gap-1.5">
      <span className="shrink-0 text-text-faint">{label}:</span>
      <span className="truncate text-text-soft" title={title ?? value}>
        {value}
      </span>
    </div>
  )
}
