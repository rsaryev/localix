import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/**
 * One status bar per window, contributed into.
 *
 * There is exactly ONE status bar; an editor does not dock a second one under itself. The
 * active editor contributes entries for `Ln {0}, Col {1}`, the indentation and the language
 * mode, then CLEARS those entries when the active editor is not a text editor. The shape this
 * avoids is a per-editor status bar stacked on top of the app one: 2 × `--statusbar-height` of
 * chrome at the bottom of the editor column and a seam the chat column beside it did not have.
 *
 * This is that contribution channel, kept deliberately small: the app status bar
 * renders a `WorkbenchStatusOutlet`, and the focused editor renders its status
 * items inside a `WorkbenchStatusContribution`, which portals them there. The
 * items themselves stay ordinary React — so the indentation and language MENUS
 * keep working unchanged, which a serialized `{ text, command }` entry could not
 * have offered without rebuilding both pickers.
 *
 * Lifecycle is React's: when the contributing editor stops being focused (or
 * unmounts, or the active tab is not an editor at all) the portal unmounts and
 * the entries disappear. There is no registry to leak stale entries from.
 */
type StatusSlot = HTMLElement | null

interface StatusHostValue {
  slot: StatusSlot
  setSlot: (element: StatusSlot) => void
}

const WorkbenchStatusHostContext = createContext<StatusHostValue | null>(null)

/** Provides the single status outlet to everything below it (the app shell). */
export function WorkbenchStatusHost({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<StatusSlot>(null)
  const value = useMemo<StatusHostValue>(() => ({ slot, setSlot }), [slot])
  return (
    <WorkbenchStatusHostContext.Provider value={value}>
      {children}
    </WorkbenchStatusHostContext.Provider>
  )
}

/**
 * The right-aligned landing zone inside the app status bar. Empty (zero width)
 * until something contributes, so a window with no editor focused looks exactly
 * like a window that never had this slot.
 */
export function WorkbenchStatusOutlet({ className, ...props }: ComponentProps<'div'>) {
  const host = useContext(WorkbenchStatusHostContext)
  return (
    <div
      data-slot="workbench-status-outlet"
      ref={host?.setSlot}
      className={cn('flex h-full shrink-0 items-stretch', className)}
      {...props}
    />
  )
}

/**
 * Renders `children` into the app status bar while `active`.
 *
 * `active` is the caller's "am I the one?" rule — for editors, the active tab of
 * the focused group, so a side-by-side split contributes ONCE (only the
 * active group's status shows). Without a host above it the children render in
 * place, so a surface mounted outside the shell still shows its status instead
 * of silently losing it.
 */
export function WorkbenchStatusContribution({
  active = true,
  children,
}: {
  active?: boolean
  children: ReactNode
}) {
  const host = useContext(WorkbenchStatusHostContext)
  if (!active) return null
  if (!host?.slot) return <>{children}</>
  return createPortal(children, host.slot)
}
