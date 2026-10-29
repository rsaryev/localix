import type { AgentTool } from '@localixai/agent/agents'

import { isRecord } from '../../lib/record'
import { withAppViewResults } from './native-app-view'
import type { BackendSubsystem } from '../ext/subsystem-contrib'
import type {
  MemoryProvider,
  MiniAppChannel,
  MiniAppContext,
  MiniAppRegistration,
} from '@localixai/mini-app-sdk/backend'

/**
 * Structural shaping of whatever a native mini app's `register()` returns into the real runtime
 * shapes. Native mini apps are TRUSTED but untyped JS, so every exported value is structurally
 * validated here before use.
 */

export interface NativeModuleExports {
  register?: (ctx: MiniAppContext) => RegisterResult | Promise<RegisterResult>
}

export type RegisterResult = MiniAppRegistration | undefined

function looksLikeChannel(c: unknown): c is MiniAppChannel {
  return (
    isRecord(c) &&
    typeof c.name === 'string' &&
    typeof (c as { start?: unknown }).start === 'function'
  )
}

/** Structural check that an exported value looks like a `BackendSubsystem`. */
function looksLikeBackendSubsystem(s: unknown): s is BackendSubsystem {
  return isRecord(s) && typeof s.id === 'string' && s.id.length > 0
}

/** Coerce a register() `backend` field (one or many) into a validated array. */
export function asBackendSubsystemArray(value: unknown): BackendSubsystem[] {
  if (Array.isArray(value)) return value.filter(looksLikeBackendSubsystem)
  if (looksLikeBackendSubsystem(value)) return [value]
  return []
}

export function asChannelArray(value: unknown): MiniAppChannel[] {
  return Array.isArray(value) ? value.filter(looksLikeChannel) : []
}

/** Structural check that an exported value looks like an AgentTool. */
function looksLikeTool(t: unknown): t is AgentTool {
  if (!isRecord(t)) return false
  return (
    typeof t.name === 'string' &&
    typeof t.description === 'string' &&
    Boolean(t.inputSchema) &&
    typeof (t as { execute?: unknown }).execute === 'function'
  )
}

/**
 * Ensure required UI fields exist without overwriting what the author set, and name an
 * offered app view to the model (`native-app-view.ts`).
 */
function normalizeTool(t: AgentTool): AgentTool {
  return { ...t, activeVerb: t.activeVerb ?? 'Running', execute: withAppViewResults(t) }
}

export function asToolArray(value: unknown): AgentTool[] {
  if (Array.isArray(value))
    return value.flatMap((t) => (looksLikeTool(t) ? [normalizeTool(t)] : []))
  if (looksLikeTool(value)) return [normalizeTool(value)]
  return []
}

/** Structural check that an exported value looks like a MemoryProvider. */
export function asMemoryProvider(value: unknown): MemoryProvider | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.loadContext !== 'function') return undefined
  return value as unknown as MemoryProvider
}
