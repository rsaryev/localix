import { assetBindings, type MessageBinding } from '@localixai/agent'

import type { LoadedMiniAppHook } from './loader-contract'
import { isRecord } from '../../lib/record'
import { HOOK_TIMEOUT_MS, invokeHook, type HookRunOptions } from './hook-invoke'
import {
  ASSISTANT_BINDINGS_MAX,
  ASSISTANT_BINDING_DATA_CAP_BYTES,
} from '@localixai/mini-app-sdk/backend'

// Message hooks: the user-prompt and assistant-reply rewrite/annotate hooks.

/**
 * Run every mini app's `onUserMessage` hook against the run's prompt text.
 * Rewrites compose in mini app load order (each later mini app sees the previous
 * rewrite); the return value is the MODEL-FACING text for this run — callers
 * never persist it over the user's original message. Returns the input text
 * unchanged when no enabled mini app declares the hook.
 */
export async function runUserMessageHooks(
  hookEntries: readonly LoadedMiniAppHook[],
  message: { messageId: string; text: string },
  options: HookRunOptions,
): Promise<string> {
  const entries = hookEntries.filter((e) => e.hooks.onUserMessage)
  if (entries.length === 0) return message.text
  const timeoutMs = options.timeoutMs ?? HOOK_TIMEOUT_MS
  let text = message.text
  for (const { app, hooks } of entries) {
    const outcome = await invokeHook(
      app,
      'onUserMessage',
      () =>
        hooks.onUserMessage!({ sessionId: options.sessionId, messageId: message.messageId, text }),
      timeoutMs,
      options.logger,
    )
    if (!isRecord(outcome)) continue
    if (typeof outcome.text === 'string' && outcome.text.trim()) {
      text = outcome.text
    } else if ('text' in outcome) {
      options.logger?.warn(
        `[mini-app:${app}] onUserMessage rewrite ignored (text must be a non-empty string)`,
      )
    }
  }
  return text
}

/** Structural guard at the mini app trust boundary. */
function isValidBinding(value: unknown): value is MessageBinding {
  if (!isRecord(value)) return false
  const { kind } = value
  if (kind === 'context') {
    return (
      typeof value.id === 'string' &&
      typeof value.source === 'string' &&
      isRecord(value.target) &&
      typeof value.target.kind === 'string' &&
      typeof value.target.token === 'string' &&
      typeof value.target.label === 'string' &&
      isRecord(value.resolution) &&
      typeof value.resolution.status === 'string' &&
      Array.isArray(value.resolution.contributions)
    )
  }
  if (kind === 'invocation') {
    return (
      typeof value.id === 'string' &&
      typeof value.source === 'string' &&
      isRecord(value.invocation) &&
      typeof value.invocation.kind === 'string' &&
      typeof value.invocation.name === 'string' &&
      isRecord(value.presentation) &&
      typeof value.presentation.label === 'string'
    )
  }
  const { name } = value
  if (typeof name !== 'string' || !name) return false
  if (kind === 'text') {
    return typeof value.text === 'string' && typeof value.size === 'number'
  }
  if (kind !== 'image' && kind !== 'file' && kind !== 'audio') return false
  return (
    typeof value.mediaType === 'string' &&
    value.mediaType.length > 0 &&
    typeof value.data === 'string' &&
    value.data.length > 0 &&
    typeof value.size === 'number' &&
    value.size >= 0
  )
}

function bindingPayloadBytes(binding: MessageBinding): number {
  if (binding.kind === 'context') {
    const contributionBytes = binding.resolution.contributions.reduce(
      (total, contribution) => total + Buffer.byteLength(contribution.content, 'utf8'),
      0,
    )
    return (
      contributionBytes +
      assetBindings([binding]).reduce((total, asset) => {
        if (asset.kind === 'path') return total
        return (
          total + Buffer.byteLength(asset.kind === 'text' ? asset.text : (asset.data ?? ''), 'utf8')
        )
      }, 0)
    )
  }
  if (binding.kind === 'invocation') return Buffer.byteLength(binding.instruction ?? '', 'utf8')
  // A `path` binding carries no bytes at all — it names a file that stays where the user put
  // it — so its payload cost is zero. Reading `.data` here would be a type error, and guessing
  // the file's size would be a lie: this number is what a hook sees as the binding's WEIGHT in
  // the message, not the weight of what it points at.
  if (binding.kind === 'path') return 0
  return Buffer.byteLength(binding.kind === 'text' ? binding.text : (binding.data ?? ''), 'utf8')
}

function bindingLabel(binding: MessageBinding): string {
  if (binding.kind === 'context') return binding.target.label
  if (binding.kind === 'invocation') return binding.presentation.label
  return binding.name
}

/**
 * Run every mini app's `onAssistantMessage` hook against the run's final reply.
 * Content rewrites compose in mini app order (each later mini app sees the previous
 * rewrite); bindings accumulate across mini apps, validated per entry and
 * capped at {@link ASSISTANT_BINDINGS_MAX} total /
 * {@link ASSISTANT_BINDING_DATA_CAP_BYTES} bytes each (violations
 * dropped + logged). Returns `{}` when no enabled mini app declares the hook.
 */
export async function runAssistantMessageHooks(
  hookEntries: readonly LoadedMiniAppHook[],
  message: { messageId: string; content: string },
  options: HookRunOptions,
): Promise<{ content?: string; bindings?: MessageBinding[] }> {
  const entries = hookEntries.filter((e) => e.hooks.onAssistantMessage)
  if (entries.length === 0) return {}
  const timeoutMs = options.timeoutMs ?? HOOK_TIMEOUT_MS

  let content: string | undefined
  const bindings: MessageBinding[] = []
  for (const { app, hooks } of entries) {
    const outcome = await invokeHook(
      app,
      'onAssistantMessage',
      () =>
        hooks.onAssistantMessage!({
          sessionId: options.sessionId,
          messageId: message.messageId,
          content: content ?? message.content,
        }),
      timeoutMs,
      options.logger,
    )
    if (!isRecord(outcome)) continue
    if ('content' in outcome) {
      if (typeof outcome.content === 'string' && outcome.content.trim()) {
        content = outcome.content
      } else {
        options.logger?.warn(
          `[mini-app:${app}] onAssistantMessage content rewrite ignored (must be a non-empty string)`,
        )
      }
    }
    if (Array.isArray(outcome.bindings)) {
      for (const binding of outcome.bindings) {
        if (bindings.length >= ASSISTANT_BINDINGS_MAX) {
          options.logger?.warn(
            `[mini-app:${app}] binding dropped (cap of ${ASSISTANT_BINDINGS_MAX} per message reached)`,
          )
          break
        }
        if (!isValidBinding(binding)) {
          options.logger?.warn(`[mini-app:${app}] binding dropped (invalid shape)`)
          continue
        }
        if (bindingPayloadBytes(binding) > ASSISTANT_BINDING_DATA_CAP_BYTES) {
          options.logger?.warn(
            `[mini-app:${app}] binding "${bindingLabel(binding)}" dropped (exceeds ${ASSISTANT_BINDING_DATA_CAP_BYTES} bytes)`,
          )
          continue
        }
        bindings.push(binding)
      }
    }
  }
  return {
    ...(content !== undefined ? { content } : {}),
    ...(bindings.length > 0 ? { bindings } : {}),
  }
}
