// Assemble a direction exactly as `motion_studio create` forks it, into <workspace>/.localix/motion/<id>/,
// for developing and reviewing the direction with the HyperFrames CLI:
//   bun scripts/try-direction.ts blackout /tmp/ws && cd /tmp/ws/.localix/motion/blackout && npx hyperframes@0.8.143 snapshot . --frames 8
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createProject } from '../backend/projects'

const [id, workspace, format] = process.argv.slice(2)
if (!id || !workspace)
  throw new Error('Usage: bun scripts/try-direction.ts <direction> <workspace> [format]')
await mkdir(workspace, { recursive: true })
await rm(join(workspace, '.localix/motion', id), { recursive: true, force: true })
const created = await createProject(workspace, {
  title: id,
  direction: id,
  name: id,
  ...(format ? { format: format as 'landscape' | 'portrait' | 'square' } : {}),
})
console.log(join(workspace, '.localix/motion', created))
