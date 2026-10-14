import type { ReactNode } from 'react'
import { Kbd } from '../keyboard/kbd'

/**
 * Shared visual primitive for append-only completion across text inputs. The
 * compact keycap is intentionally shown only while ghost text is visible, so
 * discoverability does not add permanent input chrome.
 */
export function InlineCompletionGhost({ children }: { children: ReactNode }) {
  return (
    <>
      <span className="text-text-faint">{children}</span>
      <span className="ml-1.5 inline-flex select-none items-center whitespace-nowrap align-middle opacity-80">
        <Kbd className="border-control-border/55 bg-surface-raised/90 px-1.5 py-0.5 leading-none shadow-(--shadow-raised)">
          Tab
        </Kbd>
      </span>
    </>
  )
}
