import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))

/** The repository root, independent of the caller's working directory. */
export const repoRoot = () => ROOT
