import { Copy, MapPin } from 'lucide-react'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import { copyText } from '@localixai/plugin-sdk/ui/interactions'
import type { LspDiagnostic } from '@/shared/api/contracts'

/**
 * One problem row's menu.
 *
 * A diagnostic is text a person needs OUT of the app more often than they need anything done to
 * it — pasted into a search, a message, a prompt — and the row offered no way to take it: the
 * message truncates, so even selecting it by hand got a clipped copy. `file:line:column` is the
 * form every terminal, editor and stack trace already speaks.
 */
export function problemMenu(
  file: string,
  diagnostic: LspDiagnostic,
  onGo: () => void,
): MenuEntry[] {
  const location = `${file}:${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}`
  return [
    { id: 'go', label: 'Go to problem', icon: MapPin, onSelect: onGo },
    { separator: true },
    {
      id: 'copy-message',
      label: 'Copy message',
      icon: Copy,
      onSelect: () => void copyText(diagnostic.message, 'Problem'),
    },
    {
      id: 'copy-location',
      label: 'Copy file, line and column',
      icon: Copy,
      onSelect: () => void copyText(location, 'Location'),
    },
  ]
}
