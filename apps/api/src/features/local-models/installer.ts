/**
 * Puts the pinned runtime and local models under one root (`~/.localix/models`).
 *
 * Layout:
 *   runtime/<tag>/            the extracted llama.cpp build
 *   models/<safe id>/         one folder per installed model: its files + `manifest.json`
 *   downloads/                transport only (an archive before extraction)
 *
 * Every step is atomic. An archive is extracted beside its final folder and renamed into place;
 * a model file is renamed from its verified `.part`; and a model's manifest is written LAST,
 * after every file verified — so a model counts as installed only when it is complete, and an
 * interrupted download resumes as "not installed" rather than as a broken model.
 */
import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { LocalModelSpec } from './contracts'
import { downloadPinned, isDownloaded, type DownloadProgress } from '../../lib/pinned-download'
import type { RuntimeBuild } from './runtime'

const execFileAsync = promisify(execFile)
const EXTRACT_TIMEOUT_MS = 120_000
const MANIFEST = 'manifest.json'
/** Written when a download starts, removed when it completes: marks a resumable partial model. */
const PENDING = 'pending.json'
/** Beside `pending.json` when quitting cut the download: the next start resumes it on its own. */
const RESUME = 'resume-on-start'
/** A download fetched ahead of need (`background.ts`): it stays quiet, paused or resumed. */
const BACKGROUND = 'background'

export interface InstallPaths {
  root: string
  runtimeDir(build: RuntimeBuild): string
  runtimeExecutable(build: RuntimeBuild): string
  modelDir(modelId: string): string
  /** Absolute path of one of a model's files. */
  modelFile(modelId: string, fileName: string): string
}

/** `ggml-org/gemma-4-E2B-it-GGUF:Q4_0` → `ggml-org--gemma-4-E2B-it-GGUF--Q4_0`. */
export const safeModelDir = (modelId: string) => modelId.replace(/[^\w.-]+/g, '--')

export function installPaths(root: string): InstallPaths {
  const runtimeDir = (build: RuntimeBuild) => path.join(root, 'runtime', build.tag)
  const modelDir = (modelId: string) => path.join(root, 'models', safeModelDir(modelId))
  return {
    root,
    runtimeDir,
    runtimeExecutable: (build) => path.join(runtimeDir(build), build.executable),
    modelDir,
    // A file of a sharded repo may sit in a sub-folder; only its base name is kept on disk.
    modelFile: (modelId, fileName) => path.join(modelDir(modelId), path.basename(fileName)),
  }
}

async function exists(p: string): Promise<boolean> {
  return !!(await stat(p).catch(() => null))
}

/** The folder in an extracted archive that holds `executable` (archives nest one folder deep). */
async function findExecutableDir(dir: string, executable: string): Promise<string | null> {
  if (await exists(path.join(dir, executable))) return dir
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const nested = path.join(dir, entry.name)
    if (await exists(path.join(nested, executable))) return nested
  }
  return null
}

export function isRuntimeInstalled(paths: InstallPaths, build: RuntimeBuild) {
  return exists(paths.runtimeExecutable(build))
}

async function extractArchive(archive: string, into: string, signal?: AbortSignal) {
  await mkdir(into, { recursive: true })
  // bsdtar reads both .tar.gz and .zip (Windows 10+ ships it as tar.exe).
  const flags = archive.endsWith('.zip') ? '-xf' : '-xzf'
  await execFileAsync('tar', [flags, archive, '-C', into], {
    timeout: EXTRACT_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    windowsHide: true,
    signal,
  })
}

export interface InstallOptions {
  signal?: AbortSignal
  onProgress?(progress: DownloadProgress): void
}

export async function installRuntime(
  paths: InstallPaths,
  build: RuntimeBuild,
  options: InstallOptions = {},
): Promise<string> {
  const finalDir = paths.runtimeDir(build)
  if (await isRuntimeInstalled(paths, build)) return paths.runtimeExecutable(build)
  const archive = path.join(paths.root, 'downloads', build.archive.name)
  await downloadPinned(build.archive, archive, options)
  const staging = `${finalDir}.extracting`
  await rm(staging, { recursive: true, force: true })
  try {
    await extractArchive(archive, staging, options.signal)
    const found = await findExecutableDir(staging, build.executable)
    if (!found) throw new Error(`${build.archive.name} has no ${build.executable}`)
    if (process.platform !== 'win32') await chmod(path.join(found, build.executable), 0o755)
    await rm(finalDir, { recursive: true, force: true })
    await mkdir(path.dirname(finalDir), { recursive: true })
    await rename(found, finalDir)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
  // The archive is only a transport; the extracted folder is the install.
  await rm(archive, { force: true })
  return paths.runtimeExecutable(build)
}

/** Download every file of a model, verified, then write its manifest. Resumes completed files. */
export async function installModel(
  paths: InstallPaths,
  spec: LocalModelSpec,
  options: InstallOptions & { onFileDone?(bytes: number): void } = {},
): Promise<void> {
  const dir = paths.modelDir(spec.id)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, PENDING), JSON.stringify({ spec }))
  await rm(path.join(dir, RESUME), { force: true })
  for (const file of spec.files) {
    await downloadPinned(file, paths.modelFile(spec.id, file.name), options)
    options.onFileDone?.(file.bytes)
  }
  await writeFile(
    path.join(dir, MANIFEST),
    JSON.stringify({ spec, installedAt: new Date().toISOString() }, null, 2),
  )
  await rm(path.join(dir, PENDING), { force: true })
  await rm(path.join(dir, BACKGROUND), { force: true })
}

/** Bytes of a model already on disk: finished files plus the partial one. */
async function bytesOnDisk(paths: InstallPaths, spec: LocalModelSpec): Promise<number> {
  let total = 0
  for (const file of spec.files) {
    const dest = paths.modelFile(spec.id, file.name)
    const done = await stat(dest).catch(() => null)
    const part = done ? null : await stat(`${dest}.part`).catch(() => null)
    total += done?.size ?? part?.size ?? 0
  }
  return total
}

/** Downloads that started and did not finish: resumable, listed until resumed or cancelled. */
/**
 * Mark a download cut by quitting, synchronously (the process is going away). A download the
 * person paused carries no mark and stays paused.
 */
/** Mark a download cut short by quitting to resume at next start. */
export function markResumeOnStart(paths: InstallPaths, modelId: string) {
  try {
    writeFileSync(path.join(paths.modelDir(modelId), RESUME), '')
  } catch {
    // No folder yet (still queued): nothing was fetched, nothing to resume.
  }
}

/** Whether a download's files on disk were fetched ahead of need, or asked for by a person. */
export async function markBackground(paths: InstallPaths, modelId: string, background: boolean) {
  const marker = path.join(paths.modelDir(modelId), BACKGROUND)
  if (!background) return rm(marker, { force: true })
  await mkdir(paths.modelDir(modelId), { recursive: true })
  await writeFile(marker, '')
}

export interface PartialModel {
  spec: LocalModelSpec
  /** Bytes already on disk. */
  received: number
  /** Cut short by quitting (resume at start), not paused by a person. */
  resume: boolean
  /** Fetched ahead of need: resumes without a notice. */
  background: boolean
}

export async function listPartialModels(paths: InstallPaths): Promise<PartialModel[]> {
  const modelsRoot = path.join(paths.root, 'models')
  const entries = await readdir(modelsRoot, { withFileTypes: true }).catch(() => [])
  const out: PartialModel[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = path.join(modelsRoot, entry.name)
    if (await stat(path.join(dir, MANIFEST)).catch(() => null)) continue
    const raw = await readFile(path.join(dir, PENDING), 'utf8').catch(() => null)
    if (!raw) continue
    try {
      const { spec } = JSON.parse(raw) as { spec: LocalModelSpec }
      out.push({
        spec,
        received: await bytesOnDisk(paths, spec),
        resume: await exists(path.join(dir, RESUME)),
        background: await exists(path.join(dir, BACKGROUND)),
      })
    } catch {
      // An unreadable marker is not a resumable download; cancel removes the folder.
    }
  }
  return out
}

/** Bytes of a model still to download (files already verified on disk count as done). */
export async function pendingModelBytes(paths: InstallPaths, spec: LocalModelSpec) {
  let total = 0
  for (const file of spec.files) {
    if (!(await isDownloaded(file, paths.modelFile(spec.id, file.name)))) total += file.bytes
  }
  return total
}

/** Every installed model: a manifest whose files are all present at their pinned size. */
export async function listInstalledModels(paths: InstallPaths): Promise<LocalModelSpec[]> {
  const modelsRoot = path.join(paths.root, 'models')
  const entries = await readdir(modelsRoot, { withFileTypes: true }).catch(() => [])
  const out: LocalModelSpec[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const raw = await readFile(path.join(modelsRoot, entry.name, MANIFEST), 'utf8').catch(
      () => null,
    )
    if (!raw) continue
    try {
      const { spec } = JSON.parse(raw) as { spec: LocalModelSpec }
      let complete = true
      for (const file of spec.files) {
        if (!(await isDownloaded(file, paths.modelFile(spec.id, file.name)))) complete = false
      }
      if (complete) out.push(spec)
    } catch {
      // An unreadable manifest is not an installed model; the folder is left for removal.
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Undo a download. A model that was not installed loses its folder. An installed one fetching
 * what an update adds (a draft model) keeps everything its manifest lists: only the added and
 * partial files go — cancelling an update must never remove the model it updates.
 */
export async function discardDownload(paths: InstallPaths, modelId: string) {
  const dir = paths.modelDir(modelId)
  const raw = await readFile(path.join(dir, MANIFEST), 'utf8').catch(() => null)
  if (!raw) return removeInstalledModel(paths, modelId)
  const { spec } = JSON.parse(raw) as { spec: LocalModelSpec }
  const keep = new Set([MANIFEST, ...spec.files.map((f) => path.basename(f.name))])
  for (const entry of await readdir(dir).catch(() => [] as string[])) {
    if (!keep.has(entry)) await rm(path.join(dir, entry), { recursive: true, force: true })
  }
}

/** Delete a model's folder: its files, manifest and any partial download. */
export async function removeInstalledModel(paths: InstallPaths, modelId: string) {
  await rm(paths.modelDir(modelId), { recursive: true, force: true })
}
