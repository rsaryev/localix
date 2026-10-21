/**
 * The hover slot the message's actions live in.
 *
 * Quiet until asked for: a transcript is text, and a row of six controls under every card
 * competes with it. The controls stay one pointer-move away, and a keyboard reaches them
 * because focus inside the card reveals them too.
 *
 * Three details here are load-bearing and each was a bug once:
 *
 *   - `lx-hover-actions` is the shared class a touch device forces visible. A pointer that
 *     cannot hover must not lose the actions entirely.
 *   - `has-[[data-state=open]]` keeps them while the overflow menu is open. That menu portals
 *     out of this subtree, so focus-within alone would drop the row out from under it.
 *   - IN FLOW and opacity-only. The version index.css records as removed was two absolutely
 *     positioned layers with fixed heights, which is what made touch devices re-flow the row;
 *     nothing here moves.
 */
import type { ReactNode } from 'react'

export function MessageActionsRow({ children }: { children: ReactNode }) {
  return (
    <span className="lx-hover-actions flex min-w-0 items-center opacity-0 transition-opacity duration-(--dur-fast) group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-state=open]]:opacity-100">
      {children}
    </span>
  )
}
