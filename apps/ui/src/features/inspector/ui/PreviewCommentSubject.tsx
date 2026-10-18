import type { VfCapture } from '@localixai/visual-feedback/protocol'

/**
 * What a preview comment is about, in one line: the element, and the source location if the
 * page gave us one. The preview's whole contribution to the shared comment card — everything
 * else about writing a comment is the same here as on any text surface.
 */
export function PreviewCommentSubject({
  capture,
  index,
  noScreenshot = false,
}: {
  capture: VfCapture
  /** The comment's number on the page, when an existing one is reopened. */
  index?: number
  /** The page could not render the element: the comment goes with its selector and source only. */
  noScreenshot?: boolean
}) {
  // The most useful locator to confirm what is being commented on: the resolved source
  // file:line when we have it, else the component path (an external React dev preview with no
  // served file).
  const src = capture.source?.file
  const locator = src
    ? `${src}${capture.source?.line ? `:${capture.source.line}` : ''}`
    : capture.componentPath
  return (
    <div className="mb-1.5 flex flex-col gap-0.5">
      <div
        className="truncate rounded-md bg-surface-hover px-2 py-1 text-2xs text-text-soft"
        title={[capture.summary, locator].filter(Boolean).join(' · ')}
      >
        {index !== undefined && (
          <span className="mr-1 font-semibold text-foreground">#{index}</span>
        )}
        {capture.summary}
        {locator && <span className="ml-1 text-text-faint">· {locator}</span>}
      </div>
      {noScreenshot && (
        <p className="px-2 text-2xs text-text-faint">
          No screenshot — the page could not render this element. Its location is still attached.
        </p>
      )}
    </div>
  )
}
