import { Bell } from 'lucide-react'
import { defineUiLocation } from '@localixai/mini-app-sdk/ui'

export const NOTIFICATION_CENTER_OVERLAY_ID = 'notification-center'

export default defineUiLocation({
  id: 'notifications.open',
  uri: 'localix://ui/overlay/notifications',
  // The one "open" command, in the palette and in search. The palette used to add a hand-written
  // "Open Event Center" beside it — two rows for one action. Grouped with the palette's other two
  // journal commands (mark read, clear) so the three sit together.
  title: 'Event Center',
  description: 'Open the searchable event journal',
  agent: { description: 'Open the searchable event journal' },
  keywords: ['alerts', 'bell', 'inbox', 'history', 'events', 'journal'],
  group: 'Events',
  Icon: Bell,
  effect: 'read',
  surface: 'overlay',
  exposure: { search: true, palette: true },
  resolve: () => ({ kind: 'overlay', overlayId: NOTIFICATION_CENTER_OVERLAY_ID }),
})
