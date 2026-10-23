import {
  createResourceContextProvider,
  type ResourceRefProvider,
} from '@localixai/mini-app-sdk/backend'
import { SYSTEM_URI, formatSystemSnapshot } from '../shared/system'
import type { SystemReader } from './system'
import { formatProcessSnapshot } from '../shared/processes'
import { formatSystemMarks } from '../shared/system-marks'
import type { ProcessService } from './processes'
import type { SystemMarksService } from './system-marks'

export function createSystemResourceProvider(
  read: SystemReader,
  processes?: ProcessService,
  marks?: SystemMarksService,
): ResourceRefProvider {
  return {
    provider: 'template',
    title: 'System overview',
    async listChildren(_userId, parentUri, query) {
      if (parentUri !== null && parentUri !== 'localix://resource/template') return []
      if (query && !'system overview operating system cpu memory bun'.includes(query.toLowerCase()))
        return []
      return [
        {
          uri: SYSTEM_URI,
          label: 'System overview',
          detail: 'Live OS, CPU, memory and Bun runtime',
          hasChildren: false,
          icon: 'system',
        },
      ]
    },
    async expand(_userId, uri) {
      if (uri !== SYSTEM_URI) return { ok: false }
      // Guarded like the marks below: a failed `ps` used to fail the whole expansion, so the agent
      // lost the system snapshot too because one optional section could not be collected.
      const snapshot = processes ? await processes.read().catch(() => null) : null
      const marked = marks ? await marks.list().catch(() => null) : null
      return {
        ok: true,
        content: [
          formatSystemSnapshot(read()),
          snapshot ? formatProcessSnapshot(snapshot, 50) : '',
          marked?.marks.length ? formatSystemMarks(marked) : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
        language: 'text',
      }
    },
  }
}

export function createSystemContextProvider(resourceProvider: ResourceRefProvider) {
  return createResourceContextProvider({
    id: 'template:system-context',
    namespace: 'template',
    expander: resourceProvider,
    accepts: (uri) => uri === SYSTEM_URI,
    destinations: ['chat', 'subagent', 'edit-prediction'],
    sensitivity: 'project',
    maxTokens: 1000,
  })
}
