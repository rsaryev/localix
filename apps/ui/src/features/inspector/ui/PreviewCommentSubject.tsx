import type { VfCapture } from '@localixai/visual-feedback/protocol'

/**
 * What a preview comment is about, in one line: the element, and the source location if the
 * page gave us one. The preview's whole contribution to the shared comment card — everything
 * else about writing a comment is the same here as on any text surface.
 */
export function PreviewCommentSubject({ capture }: { capture: VfCapture }) {
  // The most useful locator to confirm what is being commented on: the resolved source
  // file:line when we have it, else the component path (an external React dev preview with no
  // served file).
  const src = capture.source?.file
  const locator = src
    ? `${src}${capture.source?.line ? `:${capture.source.line}` : ''}`
    : capture.componentPath
  return (
    <div
      className="mb-1.5 truncate rounded-md bg-surface-hover px-2 py-1 text-2xs text-text-soft"
      title={[capture.summary, locator].filter(Boolean).join(' · ')}
    >
      {capture.summary}
      {locator && <span className="ml-1 text-text-faint">· {locator}</span>}
    </div>
  )
}
