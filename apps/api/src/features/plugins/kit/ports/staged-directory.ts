import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  CommitFailure,
  PreviousCopy,
  StagedCommit,
  StagedDirectory,
} from '@rsaryev/llx-plugin/marketplace'
import { errorMessage } from '../../../../lib/errors'
import { openDirectory } from './marketplace-io'

/**
 * A fetched plugin's staged directory, installed into a cache version folder so a reader sees the
 * old copy or the new, never a mix: an earlier copy is renamed aside, the new one renamed in, and
 * the earlier one renamed back when that fails. With a plan the new copy is first built beside the
 * destination as the plan says (entries copied, links relinked, targets dereferenced).
 */

const PERMISSION_CODES = new Set(['EACCES', 'EPERM', 'ENOSPC', 'EROFS'])
const codeOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException)?.code
const exists = (path: string) =>
  fs.lstat(path).then(
    () => true,
    () => false,
  )
const sibling = (path: string, what: string) => `${path}.${what}-${process.pid}-${Date.now()}`

/** Build the plan's tree at `out` from the staged directory. */
async function materialize(request: StagedCommit, out: string): Promise<void> {
  const plan = request.plan
  if (!plan) return
  await fs.mkdir(out, { recursive: true })
  for (const path of plan.copy) {
    const from = join(request.stagedPath, path)
    const to = join(out, path)
    if ((await fs.lstat(from)).isDirectory()) await fs.mkdir(to, { recursive: true })
    else {
      await fs.mkdir(dirname(to), { recursive: true })
      await fs.copyFile(from, to)
    }
  }
  for (const link of plan.relinks) {
    await fs.mkdir(dirname(join(out, link.path)), { recursive: true })
    await fs.symlink(link.target, join(out, link.path))
  }
  for (const copy of plan.dereferences)
    await fs.cp(copy.from, join(out, copy.path), { recursive: true, dereference: true })
}

async function commit(
  request: StagedCommit,
  signal: AbortSignal,
): Promise<undefined | CommitFailure> {
  const { destination } = request
  if (signal.aborted)
    return { failure: 'aborted', message: 'The install was cancelled', previous: 'none' }
  const built = request.plan ? sibling(destination, 'incoming') : request.stagedPath
  const aside = sibling(destination, 'previous')
  let previous: PreviousCopy = 'none'
  try {
    await fs.mkdir(dirname(destination), { recursive: true })
    await materialize(request, built)
    if (await exists(destination)) {
      await fs.rename(destination, aside)
      previous = 'moved-back'
    }
    await fs.rename(built, destination)
  } catch (error) {
    if (request.plan) await fs.rm(built, { recursive: true, force: true }).catch(() => {})
    const restored =
      previous === 'none' ||
      (await fs.rename(aside, destination).then(
        () => true,
        () => false,
      ))
    const code = codeOf(error)
    return {
      failure: code !== undefined && PERMISSION_CODES.has(code) ? 'permission' : 'busy',
      message: errorMessage(error),
      ...(code === undefined ? {} : { code }),
      previous: restored ? previous : 'could-not-be-moved-back',
      ...(restored ? {} : { leftOnDisk: [aside] }),
    }
  }
  if (previous !== 'none') await fs.rm(aside, { recursive: true, force: true }).catch(() => {})
  return undefined
}

export const diskStagedDirectory: StagedDirectory = {
  open: openDirectory,
  commit,
  async remove(stagedPath) {
    try {
      await fs.rm(stagedPath, { recursive: true, force: true })
      return undefined
    } catch (error) {
      return { failure: 'remove', message: errorMessage(error) }
    }
  },
}
