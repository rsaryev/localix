import { lazy, Suspense, type ComponentProps, type ReactNode } from 'react'

import { Drawer, DrawerBody, DrawerContent, DrawerTitle } from '@localixai/kit/drawer'
import { LoadingHint } from '@localixai/kit/empty-hint'

const ModelBrowser = lazy(() =>
  import('./ModelBrowser').then((module) => ({ default: module.ModelBrowser })),
)

/**
 * The drawer the model picker lives in, wherever it is opened from.
 *
 * WHY THIS EXISTS. Two places open the picker — the composer and the agent editor — and each
 * used to spell out the same shell: the lazy import, the Suspense fallback, the title, and the
 * width override. The width is the part that could not survive being said twice.
 * `DrawerContent` caps itself at `md:max-w-205`, so an override has to carry the `md:` prefix
 * to win at md and up; the copy that omitted it silently lost, leaving the model list ~300px
 * wide and every model name truncated to one letter. One shell, one width, one place to be
 * wrong.
 *
 * It also keeps Vaul out of the startup graph: the browser is lazy and mounts only while open,
 * so a surface that merely offers a picker trigger does not pay for the drawer.
 */
export function ModelPickerShell({
  open,
  onOpenChange,
  title,
  children,
  ...browser
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Screen-reader title for the dialog; each surface says what it is choosing FOR. */
  title: string
  /** Rendered above the browser, inside the drawer — the composer's seed banner, say. */
  children?: ReactNode
} & ComponentProps<typeof ModelBrowser>) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent material="popover" className="overflow-hidden p-0 md:max-w-[min(1440px,98vw)]">
        <DrawerTitle className="sr-only">{title}</DrawerTitle>
        <DrawerBody className="flex flex-col p-0">
          {open && (
            <Suspense
              fallback={<LoadingHint className="min-h-64 text-xs">Loading models…</LoadingHint>}
            >
              {children}
              <ModelBrowser onDismiss={() => onOpenChange(false)} {...browser} />
            </Suspense>
          )}
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  )
}
