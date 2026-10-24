import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The probe mod as Localix's host loads it: the plugin straight from the repository. */
const root = fileURLToPath(new URL('../probe', import.meta.url))

export const PROBE_PLUGIN = {
  name: 'cc-parity-probe',
  root,
  module: join(root, 'hooks', 'register.js'),
}
