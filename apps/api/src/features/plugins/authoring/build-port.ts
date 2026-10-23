import { pluginViewTarget } from '../../../contracts/plugin-view-target'
import { errorMessage } from '../../../lib/errors'
import { formatMiniAppCheck } from './check'
import { ScaffoldError, toMiniAppName } from './scaffold'
import type { MiniAppAuthoring } from './service'

/**
 * The host side of the `plugin_build` tool: build the named user plugin, or — when the call
 * carries a description — create a NEW one first. The answer is the report the agent works from:
 * every failed check with its lines, and on creation the instruction for building the copy out.
 *
 * A description always creates. It used to continue an existing generated copy of the same name,
 * so an agent asked for a new plugin that happened to pick a name the user already had silently
 * rebuilt the user's old plugin. Creation never edits what exists: the name is normalized and the
 * first free one is taken, and the result says which.
 *
 * A passing build is not a working plugin: a generated timer passed every check with a countdown that froze
 * on the first click. So when the run can look (`canLook`: it has the browser tool), a pass says
 * where to look, at the moment the agent would otherwise report done.
 */
export async function runMiniAppBuild(
  authoring: MiniAppAuthoring,
  userId: string,
  input: { name: string; title?: string; description?: string },
  options: { canLook?: boolean } = {},
): Promise<{ text: string; ok: boolean }> {
  const description = input.description?.trim()
  if (description) return createMiniApp(authoring, userId, { ...input, description })

  try {
    const { report } = await authoring.build(userId, input.name)
    const text = formatMiniAppCheck(input.name, report)
    return {
      text: report.ok && options.canLook ? `${text}\n\n${lookHint(input.name)}` : text,
      ok: report.ok,
    }
  } catch (error) {
    return { text: errorMessage(error), ok: false }
  }
}

async function createMiniApp(
  authoring: MiniAppAuthoring,
  userId: string,
  input: { name: string; title?: string; description: string },
): Promise<{ text: string; ok: boolean }> {
  try {
    const requested = toMiniAppName(input.name)
    const name = await authoring.freeName(userId, requested)
    const created = await authoring.create(userId, {
      name,
      description: input.description,
      ...(input.title?.trim() ? { displayName: input.title.trim() } : {}),
    })
    const renamed =
      name === input.name
        ? ''
        : ` The name "${input.name}" was ${requested === input.name ? 'taken' : 'not lower-kebab-case'}, so it is "${name}" — use that name from here on.`
    return {
      text: [
        `Created ${created.displayName} (${created.name}) at ${created.dir}.${renamed}`,
        formatMiniAppCheck(created.name, created.report, { freshCopy: true }),
        created.instruction,
      ].join('\n\n'),
      // A fresh copy fails its residue check by design; creation itself succeeded.
      ok: true,
    }
  } catch (error) {
    return {
      text:
        error instanceof ScaffoldError
          ? error.message
          : `Plugin creation failed: ${errorMessage(error)}`,
      ok: false,
    }
  }
}

function lookHint(name: string): string {
  return `The running app now shows this build. Before you call it done, look at it: browser with url "${pluginViewTarget(name)}", then take_screenshot, and steps (click, type) for each action the person will take.`
}
