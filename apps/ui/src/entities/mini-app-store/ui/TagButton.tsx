import { X } from 'lucide-react'

const TAG =
  'inline-flex h-(--chrome-control-xs) items-center gap-1 rounded-full bg-field-fill px-2 text-2xs text-text-soft focus-ring'

/** A tag on an app: choosing it shows the apps that carry it. */
export function TagButton({ tag, onTag }: { tag: string; onTag: (tag: string) => void }) {
  return (
    <button
      type="button"
      data-tag={tag}
      aria-label={`Show apps tagged ${tag}`}
      className={`${TAG} hover:bg-surface-hover hover:text-foreground`}
      onClick={() => onTag(tag)}
    >
      {tag}
    </button>
  )
}

/** The tag the store is filtered by, beside the search; choosing it removes the filter. */
export function TagFilterChip({ tag, onClear }: { tag: string; onClear: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Remove the tag filter ${tag}`}
      className={`${TAG} shrink-0 text-foreground hover:bg-surface-hover`}
      onClick={onClear}
    >
      {tag}
      <X className="size-3" aria-hidden />
    </button>
  )
}
