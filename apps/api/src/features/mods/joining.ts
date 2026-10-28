import { elementTable, type ElementTable } from '@localixai/claude-plugin/mods'
import type { ModScene } from './contracts'

/**
 * What happens as a mod instance joins its project's chain, as Claude Code's engine does it:
 * `plugin.register` lets the mods already there refuse it, and `ui.resolve` builds the element
 * table its `$.ui.resolve` reads — the engine's table, as the project's mods restyle it.
 */

type Dispatch = (
  event: string,
  input: unknown,
  core: (event: unknown) => unknown,
  scene: ModScene,
  ids?: ReadonlySet<string>,
) => Promise<unknown>

/** The components a Localix surface draws a mod's tree in. */
export const DRAWN_COMPONENTS = ['Pane'] as const

/** A refusal's reason from the mods already running there, or undefined to admit it. */
export async function judgeJoin(
  dispatch: Dispatch,
  scene: ModScene,
  judges: ReadonlySet<string>,
  joining: { plugin: string; root: string; version?: string; events: readonly string[] },
): Promise<string | undefined> {
  if (judges.size === 0) return undefined
  const verdict = (await dispatch(
    'plugin.register',
    {
      name: joining.plugin,
      tier: 'user',
      root: joining.root,
      ...(joining.version ? { version: joining.version } : {}),
      provenance: `${joining.plugin}@localix`,
      uses: { events: joining.events, calls: [] },
    },
    () => ({ allow: true }),
    scene,
    judges,
  )) as { refuse?: unknown } | undefined
  return typeof verdict?.refuse === 'string' ? verdict.refuse : undefined
}

/** Each drawn component's table, through the project's `ui.resolve` hooks. */
export async function resolveTables(
  dispatch: Dispatch,
  scene: ModScene,
  ids: ReadonlySet<string>,
): Promise<Map<string, ElementTable>> {
  const tables = new Map<string, ElementTable>()
  for (const component of DRAWN_COMPONENTS) {
    const resolved = await dispatch(
      'ui.resolve',
      { surface: 'desktop', component },
      () => elementTable(),
      scene,
      ids,
    ).catch(() => null)
    tables.set(
      component,
      resolved && typeof resolved === 'object' ? (resolved as ElementTable) : elementTable(),
    )
  }
  return tables
}
