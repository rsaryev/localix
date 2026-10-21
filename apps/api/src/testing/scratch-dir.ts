import { join } from 'node:path'
import { makeTempDir } from '@localixai/testing'

/**
 * `apps/api/tmp`: git-ignored, inside the API package so its `node_modules` resolve, and outside
 * `src`, which the source lints walk. Only for a fixture whose code imports the API's own
 * dependencies; every other test takes an OS temp dir (`makeTempDir`).
 */
export const API_SCRATCH_ROOT = join(import.meta.dir, '..', '..', 'tmp')

export const makeApiScratchDir = (prefix: string): string =>
  makeTempDir(prefix, {}, API_SCRATCH_ROOT)
