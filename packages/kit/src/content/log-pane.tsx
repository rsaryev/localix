import { forwardRef, type HTMLAttributes } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'

/**
 * LogPane — the scrollable monospace `<pre>` the workbench center tabs share for
 * command output (Docker logs, `kubectl logs`, `describe`). One source of truth for
 * the pane styling so the two workbenches read identically; forwards its ref so a
 * caller keeps its own follow-pin scroll effect. Pass `aria-label` (and `role="log"`
 * for a genuinely live/streaming pane) through — they land on the element.
 */
export const LogPane = forwardRef<HTMLPreElement, HTMLAttributes<HTMLPreElement>>(function LogPane(
  { className, children, ...rest },
  ref,
) {
  return (
    <pre
      ref={ref}
      className={cn(
        'scrollbar-thin h-full overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-2xs/relaxed text-text-soft',
        className,
      )}
      {...rest}
    >
      {children}
    </pre>
  )
})
