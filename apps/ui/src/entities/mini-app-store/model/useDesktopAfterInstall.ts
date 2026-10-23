import { useEffect, useRef, useState } from 'react'
import type { MiniAppStoreEntryRecord } from '@localixai/api/client'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import type { StoreDesktopApps } from './storeActions'

/**
 * "Install with desktop app": the store install is queued as any other, and the desktop app is
 * made once that install has landed — its job done and the app listed as installed — because the
 * desktop app is drawn from the installed app's own icon. Making it can fail on its own; the
 * install stays, and the reason is kept to show beside the app.
 */
export function useDesktopAfterInstall(
  entries: readonly MiniAppStoreEntryRecord[],
  desktop: StoreDesktopApps | undefined,
) {
  const waiting = useRef(new Set<string>())
  const [problems, setProblems] = useState<Record<string, string>>({})

  const make = (name: string, title: string) => {
    if (!desktop) return
    setProblems(({ [name]: _gone, ...rest }) => rest)
    desktop
      .install(name, title)
      .catch((error: unknown) =>
        setProblems((current) => ({ ...current, [name]: errorMessage(error, 'It failed') })),
      )
  }

  useEffect(() => {
    for (const name of waiting.current) {
      const entry = entries.find((candidate) => candidate.name === name)
      if (!entry || entry.job?.phase === 'failed') {
        waiting.current.delete(name)
        continue
      }
      const landed = entry.installed && (!entry.job || entry.job.phase === 'done')
      if (!landed) continue
      waiting.current.delete(name)
      make(name, entry.displayName ?? entry.name)
    }
  })

  return {
    /** Make the desktop app once `name`'s install lands. */
    afterInstall: (name: string) => void waiting.current.add(name),
    /** Make it now, for an app already installed. */
    make,
    problems,
  }
}
