import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'

import { checkMiniApp, formatCheck, MANIFEST_FILE, type TestRunner } from '../check/check'
import type { Kit } from '../kit/kit'
import type { KitSource } from '../kit/resolve'
import { UserError } from '../lib/errors'
import { getLocalix, type GetLocalixDeps } from '../localix/get-localix'
import { installIntoLocalix, type InstallDeps } from '../localix/install'
import { assemblePackage } from '../package/assemble'
import { CATALOG_FILE, packIntoCatalog } from '../package/pack'
import { formatVerdict, validatePackage } from '../package/validate'
import { agentInstruction } from '../scaffold/prose'
import { MINI_APP_NAME_RE, scaffoldMiniApp, toMiniAppName } from '../scaffold/scaffold'
import { type ParsedArgs, stringOption } from './args'

/** What a command reaches outside itself; tests replace each part. */
export interface CliContext {
  cwd: string
  out: (text: string) => void
  /** The kit to build with, resolved on first use. */
  kit: () => Promise<{ kit: Kit; source: KitSource }>
  runTests?: TestRunner
  localix?: InstallDeps
  installer?: GetLocalixDeps
}

type Command = (args: ParsedArgs, context: CliContext) => Promise<number>

const folder = (args: ParsedArgs, context: CliContext) =>
  resolve(context.cwd, args.positional[0] ?? '.')

async function readManifest(dir: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await fs.readFile(join(dir, MANIFEST_FILE), 'utf8')) as Record<
      string,
      unknown
    >
  } catch {
    throw new UserError(`${dir} is not a mini app: it has no readable ${MANIFEST_FILE}.`)
  }
}

/** Check, then assemble the package; null (with the report printed) when the check failed. */
async function buildPackage(
  dir: string,
  context: CliContext,
): Promise<{ packageDir: string; name: string } | null> {
  const { kit } = await context.kit()
  const manifest = await readManifest(dir)
  const name = typeof manifest.name === 'string' ? manifest.name : dir
  const { report, outputs } = await checkMiniApp({
    kit,
    miniAppDir: dir,
    keepOutputs: true,
    ...(context.runTests ? { runTests: context.runTests } : {}),
  })
  context.out(formatCheck(name, report))
  if (!outputs) return null
  try {
    return { packageDir: await assemblePackage(dir, outputs), name }
  } finally {
    await fs.rm(outputs.dir, { recursive: true, force: true })
  }
}

const create: Command = async (args, context) => {
  const raw = args.positional[0]
  if (!raw) throw new UserError('Name the mini app: mini-app create <name> --description "…"')
  const name = MINI_APP_NAME_RE.test(raw) ? raw : toMiniAppName(raw)
  const dir = resolve(context.cwd, stringOption(args, 'dir') ?? name)
  const { kit } = await context.kit()
  const created = await scaffoldMiniApp({
    kit,
    dir,
    name,
    ...(stringOption(args, 'title') ? { displayName: stringOption(args, 'title')! } : {}),
    ...(stringOption(args, 'description')
      ? { description: stringOption(args, 'description')! }
      : {}),
  })
  context.out(`Created ${created.displayName} (${name}) at ${dir}.`)
  if (args.options['no-check'] !== true) {
    // The fresh copy is checked once, so the agent starts from a mini app known to build.
    const { report } = await checkMiniApp({
      kit,
      miniAppDir: dir,
      allowTemplateResidue: true,
      ...(context.runTests ? { runTests: context.runTests } : {}),
    })
    context.out(formatCheck(name, report, { freshCopy: true }))
  }
  context.out(agentInstruction({ ...created, kit }))
  return 0
}

const check: Command = async (args, context) => {
  const dir = folder(args, context)
  const { kit } = await context.kit()
  const manifest = await readManifest(dir)
  const { report } = await checkMiniApp({
    kit,
    miniAppDir: dir,
    ...(context.runTests ? { runTests: context.runTests } : {}),
  })
  context.out(
    args.options.json === true
      ? JSON.stringify(report, null, 2)
      : formatCheck(typeof manifest.name === 'string' ? manifest.name : dir, report),
  )
  return report.ok ? 0 : 1
}

const build: Command = async (args, context) => {
  const built = await buildPackage(folder(args, context), context)
  if (!built) return 1
  context.out(`Package: ${built.packageDir}`)
  return 0
}

const install: Command = async (args, context) => {
  const dir = folder(args, context)
  const built = await buildPackage(dir, context)
  if (!built) return 1
  const installed = await installIntoLocalix(built.packageDir, dir, context.localix)
  context.out(`Installed ${installed.name} ${installed.version} into Localix and switched it on.`)
  for (const warning of installed.warnings) context.out(`- warning: ${warning}`)
  return 0
}

const pack: Command = async (args, context) => {
  const dir = folder(args, context)
  const manifest = await readManifest(dir)
  const author =
    typeof manifest.author === 'string'
      ? manifest.author
      : (manifest.author as { name?: string } | undefined)?.name
  const publisher = stringOption(args, 'publisher') ?? author
  if (!publisher) {
    throw new UserError(
      'Name the publisher people will see: --publisher "<name>", or "author" in mini-app.json.',
    )
  }
  const built = await buildPackage(dir, context)
  if (!built) return 1
  const outDir = resolve(context.cwd, stringOption(args, 'out') ?? join(dir, 'dist', 'catalog'))
  const { kit } = await context.kit()
  const entry = await packIntoCatalog({ kit, packageDir: built.packageDir, outDir, publisher })
  context.out(
    [
      `Packed ${entry.name} ${entry.version} into ${join(outDir, CATALOG_FILE)}.`,
      `Upload every file in ${outDir} to one HTTPS folder (a GitHub release, a site); people add the address of ${CATALOG_FILE} there as a catalog in Localix's mini app store.`,
    ].join('\n'),
  )
  return 0
}

const validate: Command = async (args, context) => {
  const path = folder(args, context)
  const { kit } = await context.kit()
  const verdict = await validatePackage(kit, path)
  context.out(
    args.options.json === true ? JSON.stringify(verdict, null, 2) : formatVerdict(path, verdict),
  )
  return verdict.ok ? 0 : 1
}

const kitInfo: Command = async (_args, context) => {
  const { kit, source } = await context.kit()
  context.out(
    [
      `Kit: ${kit.dir} (from ${source.from})`,
      `Localix: ${kit.manifest.localixVersion ?? 'unknown'}, mini app API ${kit.manifest.apiVersion ?? 'unknown'}`,
      `Kit modules: ${kit.manifest.kitModules.length}`,
    ].join('\n'),
  )
  return 0
}

const getLocalixCommand: Command = async (_args, context) => {
  const got = await getLocalix(context.installer)
  context.out(
    got.existing
      ? `Localix is already installed at ${got.path}; opened it.`
      : `Installed the latest Localix at ${got.path} and opened it.`,
  )
  return 0
}

export const HELP = `mini-app — create, check, build, install and share Localix mini apps.

  mini-app create <name> [--title "…"] [--description "…"] [--dir <folder>] [--no-check]
  mini-app check [folder] [--json]       every gate Localix applies, in one report
  mini-app build [folder]                check, then write the package to <folder>/dist/package
  mini-app install [folder]              build, then install into the running Localix
  mini-app pack [folder] [--out <dir>] [--publisher "…"]   add the app to a shareable catalog
  mini-app validate <package folder | .tar.gz> [--json]
  mini-app kit                           which mini app kit the commands build with
  mini-app get-localix                   install the latest Localix (verified) and open it

The folder defaults to the current one. The kit comes from MINI_APP_KIT, the running Localix, the
installed Localix app, or the latest Localix release.`

export const COMMANDS: Record<string, Command> = {
  create,
  check,
  build,
  install,
  pack,
  validate,
  kit: kitInfo,
  'get-localix': getLocalixCommand,
}
