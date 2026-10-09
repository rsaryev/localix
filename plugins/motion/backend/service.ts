import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { atomicWriteFile } from '@localixai/plugin-sdk/backend'
import { openJsonStore } from './store'
import { motionDirectory, motionFile } from './files'
import { MOTION_DIR } from '../shared/file-contract'
import { createTemplateDocument } from '../shared/templates'
import {
  documentSchema,
  librarySchema,
  type MotionDocument,
  type MotionAsset,
  type TemplateId,
} from '../shared/schema'

export class MotionError extends Error {
  constructor(
    public code: 'not_found' | 'conflict' | 'limit' | 'invalid_asset',
    message: string,
  ) {
    super(message)
  }
}
export function createMotionService(workspace: string) {
  const dir = join(workspace, MOTION_DIR)
  const store = openJsonStore({
    dir,
    file: 'library.json',
    schema: librarySchema,
    initial: { projects: [], assets: [] },
  })
  const checkAssets = (document: MotionDocument, assets: MotionAsset[]) => {
    const imageIds = document.scenes.flatMap((scene) => [
      scene.imageId,
      ...scene.layers.filter((layer) => layer.kind === 'image').map((layer) => layer.assetId),
    ])
    for (const id of imageIds.filter((id): id is string => id !== null))
      if (!assets.some((asset) => asset.id === id && asset.kind === 'image'))
        throw new MotionError('invalid_asset', 'An image is missing. Upload it before saving.')
    if (
      document.soundtrackId &&
      !assets.some((asset) => asset.id === document.soundtrackId && asset.kind === 'audio')
    )
      throw new MotionError('invalid_asset', 'The soundtrack is missing. Upload it before saving.')
  }
  const ready = async () => {
    const dir = await motionDirectory(workspace)
    await motionFile(dir, 'library.json')
    return dir
  }
  const read = async () => {
    await ready()
    return store.read()
  }
  const update: typeof store.update = async (change) => {
    await ready()
    return store.update(change)
  }
  const assetPath = async (id: string) => {
    const dir = await ready()
    await mkdir(join(dir, 'assets'), { recursive: true, mode: 0o700 })
    await motionFile(dir, 'assets')
    return motionFile(dir, 'assets', id)
  }
  return {
    list: read,
    async get(id: string) {
      const project = (await read()).projects.find((item) => item.id === id)
      if (!project) throw new MotionError('not_found', 'This video no longer exists.')
      return project
    },
    async create(template: TemplateId, title: string, input?: MotionDocument) {
      const document = documentSchema.parse(input ?? createTemplateDocument(template, title))
      return update((state) => {
        if (state.projects.length >= 100)
          throw new MotionError('limit', 'The library is full. Remove an unused video first.')
        checkAssets(document, state.assets)
        return {
          ...state,
          projects: [
            ...state.projects,
            {
              id: randomUUID(),
              revision: 1,
              updatedAt: new Date().toISOString(),
              document,
            },
          ],
        }
      })
    },
    async update(id: string, revision: number, input: MotionDocument) {
      const document = documentSchema.parse(input)
      return update((state) => {
        const project = state.projects.find((item) => item.id === id)
        if (!project) throw new MotionError('not_found', 'This video no longer exists.')
        if (project.revision !== revision)
          throw new MotionError(
            'conflict',
            'The video changed. Reload the saved version before applying your edits.',
          )
        checkAssets(document, state.assets)
        return {
          ...state,
          projects: state.projects.map((item) =>
            item.id === id
              ? { ...item, document, revision: revision + 1, updatedAt: new Date().toISOString() }
              : item,
          ),
        }
      })
    },
    async remove(id: string, revision: number) {
      return update((state) => {
        const project = state.projects.find((item) => item.id === id)
        if (!project) throw new MotionError('not_found', 'This video no longer exists.')
        if (project.revision !== revision)
          throw new MotionError('conflict', 'The video changed. Reload before deleting it.')
        return { ...state, projects: state.projects.filter((item) => item.id !== id) }
      })
    },
    async upload(name: string, mime: MotionAsset['mime'], bytes: Uint8Array) {
      const id = randomUUID()
      const path = await assetPath(id)
      await atomicWriteFile(path, bytes, { mode: 0o600 })
      try {
        return await update((state) => {
          if (state.assets.length >= 200)
            throw new MotionError('limit', 'The media library is full.')
          return {
            ...state,
            assets: [
              ...state.assets,
              {
                id,
                name: name.slice(0, 200),
                mime,
                kind: mime.startsWith('image/') ? 'image' : 'audio',
                bytes: bytes.byteLength,
              },
            ],
          }
        })
      } catch (error) {
        await unlink(path).catch(() => {})
        throw error
      }
    },
    async readAsset(id: string) {
      const asset = (await read()).assets.find((item) => item.id === id)
      if (!asset) throw new MotionError('not_found', 'This media file no longer exists.')
      return { asset, bytes: await readFile(await assetPath(asset.id)) }
    },
    async removeAsset(id: string) {
      const state = await update((state) => {
        if (!state.assets.some((asset) => asset.id === id))
          throw new MotionError('not_found', 'This media file no longer exists.')
        const used = state.projects.some(
          ({ document }) =>
            document.soundtrackId === id ||
            document.scenes.some(
              (scene) =>
                scene.imageId === id ||
                scene.layers.some((layer) => layer.kind === 'image' && layer.assetId === id),
            ),
        )
        if (used)
          throw new MotionError(
            'conflict',
            'This media is used by a saved video. Remove its references first.',
          )
        return { ...state, assets: state.assets.filter((asset) => asset.id !== id) }
      })
      await unlink(await assetPath(id)).catch(() => {})
      return state
    },
  }
}
export type MotionService = ReturnType<typeof createMotionService>
