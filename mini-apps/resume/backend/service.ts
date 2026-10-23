import { readdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { applyOperations, type ResumeOperation } from '../shared/operations'
import { documentSchema, idSchema, type Resume, type ResumeDocument } from '../shared/schema'
import { resumeFileSchema, revisionSchema, type RevisionRecord } from '../shared/file-contract'
import {
  fileRevision,
  readResumeFile,
  relativeResumePath,
  resumeDirectory,
  resumeFile,
  writeResumeFile,
} from './files'
import { readRevisions, saveRevision } from './revisions'

export class ResumeError extends Error {
  constructor(
    public readonly code: 'not_found' | 'conflict' | 'invalid' | 'limit',
    message: string,
  ) {
    super(message)
  }
}
const queues = new Map<string, Promise<unknown>>()
function write<T>(workspace: string, action: () => Promise<T>): Promise<T> {
  const key = resolve(workspace)
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(action)
  queues.set(key, next)
  void next
    .finally(() => {
      if (queues.get(key) === next) queues.delete(key)
    })
    .catch(() => {})
  return next
}

/** Reads the canonical workspace file on every access, so ordinary agent file edits are visible. */
export function createResumeService(workspace: string) {
  const get = async (_userId: string, id: string): Promise<Resume> => {
    let content
    try {
      content = await readResumeFile(await resumeFile(workspace, id))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new ResumeError('not_found', 'Resume not found')
      throw error
    }
    const parsed = resumeFileSchema.safeParse(JSON.parse(content))
    if (!parsed.success || parsed.data.id !== id)
      throw new ResumeError(
        'invalid',
        `Invalid resume file: ${relativeResumePath(id)}. Fix its structure; it will not be overwritten.`,
      )
    return { ...parsed.data, revision: fileRevision(content) }
  }
  const scan = async (userId: string) => {
    const dir = await resumeDirectory(workspace)
    const resumes: Resume[] = []
    const issues: string[] = []
    if (dir)
      for (const id of (await readdir(dir)).filter((name) => idSchema.safeParse(name).success)) {
        try {
          resumes.push(await get(userId, id))
        } catch (error) {
          issues.push(
            `${relativeResumePath(id)}: ${error instanceof ResumeError ? error.message : 'Cannot read this resume. Fix the file or restore it from history.'}`,
          )
        }
      }
    return { resumes, issues }
  }
  const persist = async (
    file: string,
    resume: Omit<Resume, 'revision'>,
    actor: 'user' | 'agent',
    label: string,
  ): Promise<Resume> => {
    const content = `${JSON.stringify(resumeFileSchema.parse(resume), null, 2)}\n`
    const result = { ...resume, revision: fileRevision(content) }
    // The snapshot is durable before the head moves. A failed write never destroys the old head.
    await saveRevision(file, {
      revision: result.revision,
      document: result.document,
      actor,
      label,
      recordedAt: result.updatedAt,
    })
    await writeResumeFile(file, content)
    return result
  }
  const create = (
    userId: string,
    document: ResumeDocument,
    sourceId?: string,
    actor: 'user' | 'agent' = 'user',
  ) =>
    write(workspace, async () => {
      const content = documentSchema.parse(document)
      if ((await scan(userId)).resumes.length >= 100)
        throw new ResumeError('limit', 'The workspace is limited to 100 resumes')
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      const file = await resumeFile(workspace, id, true)
      return persist(
        file,
        {
          id,
          createdAt: now,
          updatedAt: now,
          document: content,
          ...(sourceId ? { sourceId } : {}),
        },
        actor,
        sourceId ? 'Created variant' : 'Created from template',
      )
    })
  const expectRevision = (resume: Resume, revision: string) => {
    revisionSchema.parse(revision)
    if (resume.revision !== revision)
      throw new ResumeError(
        'conflict',
        'Resume file changed. Read the current revision and reapply only your intended edits.',
      )
  }
  const update = (
    userId: string,
    id: string,
    revision: string,
    change: (document: ResumeDocument) => ResumeDocument,
    actor: 'user' | 'agent',
    label: string,
  ) =>
    write(workspace, async () => {
      const current = await get(userId, id)
      expectRevision(current, revision)
      const document = documentSchema.parse(change(current.document))
      const file = await resumeFile(workspace, id)
      await saveRevision(file, {
        revision: current.revision,
        document: current.document,
        actor: 'external',
        label: 'State before edit',
        recordedAt: current.updatedAt,
      })
      // Recheck after snapshot IO: a regular file tool can edit outside this mini app's write
      // queue.
      expectRevision(await get(userId, id), revision)
      const { revision: _oldRevision, ...stored } = current
      return persist(
        file,
        { ...stored, document, updatedAt: new Date().toISOString() },
        actor,
        label,
      )
    })
  return {
    get,
    scan,
    create,
    path: relativeResumePath,
    list: async (userId: string) => (await scan(userId)).resumes,
    update: (
      userId: string,
      id: string,
      revision: string,
      operations: ResumeOperation[],
      actor: 'user' | 'agent' = 'user',
    ) =>
      update(
        userId,
        id,
        revision,
        (doc) => applyOperations(doc, operations),
        actor,
        'Edited resume',
      ),
    async duplicate(userId: string, id: string, title: string, actor: 'user' | 'agent' = 'user') {
      const source = await get(userId, id)
      return create(userId, { ...source.document, title }, source.id, actor)
    },
    async history(userId: string, id: string): Promise<RevisionRecord[]> {
      const current = await get(userId, id)
      const records = await readRevisions(await resumeFile(workspace, id))
      return records.some((record) => record.revision === current.revision)
        ? records
        : [
            {
              revision: current.revision,
              document: current.document,
              recordedAt: current.updatedAt,
              actor: 'external',
              label: 'Current file state',
            },
            ...records,
          ]
    },
    async restore(
      userId: string,
      id: string,
      revision: string,
      target: string,
      actor: 'user' | 'agent' = 'user',
    ) {
      const record = (await this.history(userId, id)).find(
        (item) => item.revision === revisionSchema.parse(target),
      )
      if (!record) throw new ResumeError('not_found', 'Saved revision not found')
      return update(userId, id, revision, () => record.document, actor, 'Restored saved revision')
    },
    remove: (userId: string, id: string, revision: string) =>
      write(workspace, async () => {
        expectRevision(await get(userId, id), revision)
        await rm(dirname(await resumeFile(workspace, id)), { recursive: true })
      }),
  }
}
export type ResumeService = ReturnType<typeof createResumeService>
