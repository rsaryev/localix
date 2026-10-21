import { Library } from 'lucide-react'
import { defineUiLocation } from '@localixai/plugin-sdk/ui'

export const SOURCES_OVERLAY_ID = 'session-sources'

/**
 * The source entry point exposed to navigation as an overlay-shaped command.
 *
 * A surface file rather than a bare component so the entry point comes for free: the discovery
 * glob picks it up, which gives it a command-palette entry, `/open`, a bindable key, and agent
 * navigation without a second visible control. ChatPage resolves it into the unified Activity
 * work item, focused on Sources, so command-palette and agent navigation share the message action's
 * non-modal behavior.
 */
export default defineUiLocation({
  id: 'chat.sources.open',
  uri: 'localix://ui/overlay/sources',
  title: 'Sources',
  description: 'Open the evidence consulted for a conversation answer',
  agent: { description: 'Show the sources consulted for a conversation answer' },
  keywords: ['provenance', 'citations', 'context', 'evidence', 'files'],
  group: 'Navigation',
  Icon: Library,
  effect: 'read',
  surface: 'overlay',
  params: {
    // `message`, not `messageId`: param keys must match /^[a-z][a-z0-9_-]{0,63}$/ and a camelCase
    // key is rejected at registration — silently, unless the discovery test catches it.
    message: {
      type: 'string',
      description: 'Optional answer whose consulted sources should be shown.',
      optional: true,
      maxLength: 256,
    },
    // Which conversation to show — and whose Activity tab shows it (one per chat). A button inside
    // a chat pane names its own chat. Absent (palette, `/open`), the page passes the chat that is
    // open explicitly; with none open, nothing opens.
    session: {
      type: 'string',
      description: 'Conversation to show; defaults to the chat that is open.',
      optional: true,
      maxLength: 256,
    },
  },
  exposure: { search: true, palette: true },
  present: () => ({ label: 'Sources' }),
  resolve: ({ message, session }) => ({
    kind: 'overlay',
    overlayId: SOURCES_OVERLAY_ID,
    ...(message === undefined && session === undefined
      ? {}
      : {
          params: {
            ...(message === undefined ? {} : { message }),
            ...(session === undefined ? {} : { session }),
          },
        }),
  }),
})
