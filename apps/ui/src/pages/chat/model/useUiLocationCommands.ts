import { useMemo } from 'react'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { invokeUi } from '@/shared/lib/uiNavigation'
import type { PaletteCommand } from '@/shared/contrib/uiCommands'
import { buildUiLocationUri } from '@/shared/contrib/uiLocations'
import { useUiLocations } from '@/shared/contrib/useUiLocations'

/**
 * Palette adapter over the live location catalog. A feature opts in once in its
 * own surface descriptor; no palette composition file learns the feature name.
 *
 * `sessionId` is the chat the palette's page has open: a location that resolves to a session
 * surface opens there, and with no chat open such a location opens nothing.
 */
export function useUiLocationCommands(sessionId: string | null): PaletteCommand[] {
  const navigation = useUiNavigation({ sessionId })
  const locations = useUiLocations('palette')

  return useMemo(
    () =>
      locations.flatMap((location) => {
        const access = location.effect === 'write' ? { allowWrite: true as const } : {}
        const uri = buildUiLocationUri(location.id, {}, access)
        if (!uri) return []
        return [
          {
            id: `ui-location.${location.id}`,
            label: location.title,
            group: location.group ?? 'View',
            effect: location.effect,
            keywords: [...location.keywords],
            run: () => {
              invokeUi(uri, navigation, access)
            },
          },
        ]
      }),
    [navigation, locations],
  )
}
