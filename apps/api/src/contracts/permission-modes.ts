/**
 * THE SESSION PERMISSION MODES — the vocabulary, shared by the server and the composer.
 *
 * A leaf on purpose (`@localixai/api/permission-modes`): the composer's mode control and the run
 * must read ONE list, or a mode the client offers is one the server has never heard of. What a
 * mode DOES lives next to the rules it rewrites (`permission-mode-policy.ts`); this file only
 * says which modes exist, in which order the control cycles them, and how each is described.
 */

export const PERMISSION_MODES = ['default', 'plan', 'bypass', 'autonomous'] as const
export type PermissionMode = (typeof PERMISSION_MODES)[number]

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'default'

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value)
}

/** A stored value read back: anything unrecognised is the default, never a looser mode. */
export function parsePermissionMode(value: unknown): PermissionMode {
  return isPermissionMode(value) ? value : DEFAULT_PERMISSION_MODE
}

export interface PermissionModeCopy {
  label: string
  /** One sentence the control's tooltip shows — it must stand alone. */
  hint: string
}

export const PERMISSION_MODE_COPY: Record<PermissionMode, PermissionModeCopy> = {
  default: {
    label: 'Default',
    hint: "The agent's own rules decide; anything they ask about waits for you.",
  },
  plan: {
    label: 'Plan',
    hint: 'Read-only: the agent investigates and presents a plan for you to review and approve.',
  },
  bypass: {
    label: 'Bypass',
    hint: 'No permission prompts — every ask is allowed. Denials and irreversible host damage stay blocked.',
  },
  autonomous: {
    label: 'Autonomous',
    hint: 'Bypass, and nobody is expected to answer: questions and approvals are refused so work never waits.',
  },
}

/**
 * The line a mode change writes into the conversation (`permission_mode_change`), read by the
 * person and, as a context binding, by every participant. One sentence that names the mode AND
 * what it now means for the agent: "mode changed to bypass" alone left the model to guess
 * whether its next write would be refused.
 */
export const PERMISSION_MODE_NOTICE: Record<PermissionMode, string> = {
  default:
    "Permission mode: Default — the agent's own rules decide, and anything they ask about waits for the user.",
  plan: 'Permission mode: Plan — read-only until a plan is approved.',
  bypass:
    'Permission mode: Bypass — no permission prompts; denials and irreversible host damage stay blocked.',
  autonomous:
    'Permission mode: Autonomous — no prompts and no questions; decide without waiting for the user.',
}
