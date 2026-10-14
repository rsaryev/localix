/**
 * The actuator, driven by a HOST against one of its own panels instead of by a probe inside a
 * page.
 *
 * The agent's browser vocabulary — snapshot, steps, screenshot, console — reached only pages with
 * a URL: the probe runs inside the page and answers the host over postMessage. A plugin's
 * workbench view has no URL; it renders in the host's own document. So the agent that had just
 * built a plugin could not look at it, and an agent aimed the browser at the API's origin and hung
 * on a probe that never answered. A host embeds the same actuator instead, scoped to the panel's
 * element: one command vocabulary, one set of self-healing refs, one rasterizer, and no second
 * implementation of any of them.
 *
 * What stays the host's: finding the element, deciding which commands it permits (a page's
 * `evaluate` runs in the page, a host's would run in the host), and filling the console buffer
 * from sources that belong to its panel rather than to the whole window.
 */
import type { VfCommand } from '../protocol/index'
import { runCommand, type ActuateResult } from '../actuate/index'
import { createConsoleBuffer, type ConsoleBuffer } from '../actuate/console-capture'
import { createRefRegistry } from '../snapshot/index'

export { createConsoleBuffer, type ConsoleBuffer }
export type { ActuateResult }

export interface EmbeddedActuator {
  /** Run one command against `root`; refs and the diff baseline carry across calls. */
  run(command: VfCommand, root: Element): Promise<ActuateResult>
}

export function createEmbeddedActuator(options: {
  console: ConsoleBuffer
  /** The screenshot backdrop, read per command so a theme switch is honoured. */
  backdrop?: () => string | undefined
}): EmbeddedActuator {
  const reg = createRefRegistry()
  const prevTree = { value: '' }
  // The buffer is the host's; there is nothing of the page's to uninstall.
  const console = { ...options.console, uninstall() {} }
  return {
    run(command, root) {
      return runCommand(command, {
        reg,
        console,
        prevTree,
        root,
        backdrop: options.backdrop?.(),
      })
    },
  }
}
