import { ScrollText } from 'lucide-react'
import { defineUiLocation } from '@localixai/plugin-sdk/ui'

import { readTranscript, transcriptTabId } from '../model/openTranscript'

/**
 * FOCUS ONLY, deliberately.
 *
 * A transcript's content is held in memory by whoever opened it (see `openTranscript`), so a URI
 * cannot reconstruct one — it can only bring an already-open tab forward. Declaring that here is
 * what keeps the addressable surface honest instead of offering a destination that would open an
 * empty conversation.
 */
export default defineUiLocation({
  id: 'transcript.focus',
  uri: 'localix://ui/work-item/transcript',
  title: 'Transcript',
  description: 'Focus an already-open transcript',
  // `runtime`: a transcript exists only while something holds it open, so this destination fails
  // closed rather than offering to open one that cannot be reconstructed.
  agent: {
    description: 'Focus a transcript that is already open for reading.',
    availability: 'runtime',
  },
  keywords: ['transcript', 'conversation', 'history', 'read-only'],
  group: 'Application',
  Icon: ScrollText,
  effect: 'read',
  surface: 'work-item',
  params: {
    id: {
      type: 'string',
      description: 'Identity of the transcript, as its opener namespaced it.',
      maxLength: 256,
    },
  },
  exposure: { search: false, palette: false },
  // Fails closed: a transcript nobody holds open cannot be focused, and pretending otherwise
  // would hand out a destination that lands on an empty conversation.
  resolve: ({ id }) =>
    readTranscript(id) ? { kind: 'work-item-focus', id: transcriptTabId(id) } : null,
})
