/**
 * A stand-in for an API process in the shared-router tests: the orphan guard, one model router
 * over the given models folder, and its calls driven over IPC. Test-only.
 */
import { installOrphanGuard } from '../../../lib/orphan-guard'
import { installPaths } from '../installer'
import { createModelRouter } from '../router'

const [root, executable, runDir] = process.argv.slice(2) as [string, string, string]
installOrphanGuard({ runDir })
const router = createModelRouter({
  paths: installPaths(root),
  executable: async () => executable,
  models: async () => [],
})

type Command = { id: number; op: 'ensure' | 'stop' | 'reapStale' }

process.on('message', (command: Command) => {
  void (async () => {
    try {
      if (command.op === 'ensure') {
        const server = await router.ensure()
        const answer = await server.request('/models')
        process.send!({
          id: command.id,
          pid: server.pid,
          url: server.baseUrl,
          status: answer.status,
        })
      } else {
        await router[command.op]()
        process.send!({ id: command.id })
      }
    } catch (err) {
      process.send!({ id: command.id, error: err instanceof Error ? err.message : String(err) })
    }
  })()
})
process.send!({ ready: process.pid })
