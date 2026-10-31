import { Suspense, type ReactNode } from 'react'

import type { PromptInputProps } from './promptInputProps'
import { lazyNamed } from '@/shared/lib/lazyNamed'

const ComposerQueuePanel = lazyNamed(() => import('./ComposerQueuePanel'), 'ComposerQueuePanel')

/**
 * The queue docks beside send/stop: a pill in a toolbar that is always there, so it can come
 * and go without moving the composer. Loaded the first time a session has something queued.
 */
export function composerAccessory(
  serverQueue: PromptInputProps['serverQueue'],
  activeSessionId: string | null,
  accessory: ReactNode,
): ReactNode {
  if (!serverQueue || serverQueue.length === 0) return accessory
  return (
    <>
      <Suspense fallback={null}>
        <ComposerQueuePanel serverQueue={serverQueue} activeSessionId={activeSessionId} />
      </Suspense>
      {accessory}
    </>
  )
}
