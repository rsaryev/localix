import type { PluginRecord } from '../../plugins/contracts'
import type { PluginService } from '../../plugins/service-types'
import { errorMessage } from '../../../lib/errors'

/** The domain code of a failed service call, when it carries one. */
export function errorCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : undefined
}

const names = (list: readonly string[]) => list.map((name) => `\`${name}\``).join(', ')

/** Loading.md: "Your edits to the source directory take effect at the next session start or `/reload-plugins`". */
const IN_PLACE =
  'It loads in place from that folder, so your edits there take effect at `/plugin reload`, with no update and no version bump.'

/**
 * The reply to `/plugin install`. It says "enabled" only when the plugin is (a
 * `defaultEnabled: false` plugin "is installed but stays off until you turn it on"), and names the
 * dependencies installed with it: "The success message lists them."
 */
export function installReply(rec: PluginRecord): string {
  const where = rec.scope === 'project' ? 'this project' : 'all chats'
  const head = `Installed \`${rec.name}\` v${rec.version} for ${where} (\`${rec.dir}\`)`
  const deps = rec.installedDependencies ?? []
  if (!rec.enabled) {
    return [
      `${head}. It starts turned off; run \`/plugin enable ${rec.name}\` to turn it on.`,
      ...(rec.loadsInPlace ? [IN_PLACE] : []),
      ...(deps.length ? [`Also installed: ${names(deps)}.`] : []),
    ].join(' ')
  }
  return [
    `${head} and enabled it.`,
    ...(rec.loadsInPlace ? [IN_PLACE] : []),
    ...(deps.length ? [`Also installed and enabled: ${names(deps)}.`] : []),
    'Start a new turn to use it.',
  ].join(' ')
}

/**
 * The reply to `/plugin update`. A plugin loading in place from a local-folder marketplace has
 * nothing to fetch: the update checked its files again, and the reply says where it loads from.
 */
export function updateReply(rec: PluginRecord): string {
  if (rec.loadsInPlace)
    return `\`${rec.name}\` v${rec.version} loads in place from \`${rec.dir}\` and its files check out. Edits there take effect at \`/plugin reload\`; it needs no update.`
  return `Updated \`${rec.name}\` to v${rec.version}. Run \`/plugin reload\` or start a new turn for it to take effect.`
}

/**
 * `/plugin validate <path>`: the report `claude plugin validate` prints — the plugin, its errors
 * and warnings, and a verdict line from its "Output and exit codes" table.
 */
export async function validatePathReply(
  ctx: { pluginService: Pick<PluginService, 'validatePath'> },
  dir: string,
  strict: boolean,
): Promise<string> {
  let report: Awaited<ReturnType<PluginService['validatePath']>>
  try {
    report = await ctx.pluginService.validatePath(dir)
  } catch (err) {
    return `Unexpected error during validation: ${errorMessage(err)}`
  }
  const { validation } = report
  // `--strict` turns the warnings into errors; the verdict still says why it failed.
  const errors = [...validation.errors, ...(strict ? validation.warnings : [])]
  const warnings = strict ? [] : validation.warnings
  const verdict =
    validation.errors.length > 0
      ? 'Validation failed'
      : validation.warnings.length === 0
        ? 'Validation passed'
        : strict
          ? 'Validation failed (--strict treats warnings as errors)'
          : 'Validation passed with warnings'
  return [
    `**Validating \`${dir}\`:**`,
    '',
    `- \`${report.name}\` — ${errors.length} error(s), ${warnings.length} warning(s)`,
    ...errors.map((e) => `    - Error: ${e}`),
    ...warnings.map((w) => `    - Warning: ${w}`),
    '',
    verdict,
  ].join('\n')
}
