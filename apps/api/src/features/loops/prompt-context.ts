import type { SessionLoop } from './contracts'
import { plural } from '../../lib/plural'

/** Plain, agnostic shape handed to the system-prompt builder for the light `# Loops` section. */
export interface LoopPromptContext {
  loops: {
    id: string
    kind: 'fixed' | 'dynamic'
    cadence: string
    prompt: string
    target?: string
    lastRun?: string
  }[]
}

function cadence(loop: SessionLoop): string {
  if (loop.kind === 'dynamic')
    return loop.delaySeconds ? `dynamic ~${Math.round(loop.delaySeconds / 60)}m` : 'dynamic'
  return loop.cron ?? 'fixed'
}

/** Compact last-run marker for the prompt line: "3 runs, ok" / "1 run, error". */
function lastRun(loop: SessionLoop): string | undefined {
  if (!loop.runCount) return undefined
  return `${plural(loop.runCount, 'run')}, ${loop.lastStatus ?? 'pending'}`
}

/** Map a session's active loops to the light prompt context (null when there are none). */
export function toLoopPromptContext(loops: SessionLoop[]): LoopPromptContext | undefined {
  if (loops.length === 0) return undefined
  return {
    loops: loops.map((l) => ({
      id: l.id,
      kind: l.kind,
      cadence: cadence(l),
      prompt: l.prompt.length > 80 ? `${l.prompt.slice(0, 80)}…` : l.prompt,
      ...(l.target === 'subsession' ? { target: l.target } : {}),
      ...(lastRun(l) ? { lastRun: lastRun(l) } : {}),
    })),
  }
}
