import type {
  NotificationEnvelope,
  NotificationTransport,
  TerminalNotificationMethod,
} from './contracts'

export interface TerminalNotificationCapability {
  protocol: 'osc9' | 'osc777' | 'bel'
  terminal: 'warp' | 'generic'
}

export interface TerminalCapabilityInput {
  isTTY: boolean
  env: Readonly<Record<string, string | undefined>>
  method?: TerminalNotificationMethod
}

/**
 * Conservative capability detection. Warp requires both its exact TERM_PROGRAM and
 * exported client version; other terminals require an explicit override.
 */
export function detectTerminalNotificationCapability(
  input: TerminalCapabilityInput,
): TerminalNotificationCapability | null {
  if (!input.isTTY) return null
  const override = input.method ?? input.env.LOCALIX_TERMINAL_NOTIFICATIONS?.toLowerCase()
  if (override === 'off' || override === '0') return null
  if (override === 'osc9') return { protocol: 'osc9', terminal: 'generic' }
  if (override === 'osc777') return { protocol: 'osc777', terminal: 'generic' }
  if (override === 'bel') return { protocol: 'bel', terminal: 'generic' }
  const warpVersion = input.env.WARP_CLIENT_VERSION?.trim()
  if (input.env.TERM_PROGRAM === 'WarpTerminal' && warpVersion)
    return { protocol: 'osc777', terminal: 'warp' }
  return null
}

function clean(value: string): string {
  // OSC 777 uses semicolons as separators; BEL/ST terminate the command.
  return value.replace(/[;\p{Cc}]+/gu, ' ').trim()
}

export function encodeTerminalNotification(
  capability: TerminalNotificationCapability,
  envelope: NotificationEnvelope,
): string {
  const title = clean(envelope.event.title)
  const body = clean(envelope.event.body ?? envelope.event.title)
  if (capability.protocol === 'bel') return '\u0007'
  return capability.protocol === 'osc777'
    ? `\u001b]777;notify;${title};${body}\u0007`
    : `\u001b]9;${body}\u0007`
}

export function createTerminalNotificationTransport(
  capability: TerminalNotificationCapability,
  write: (value: string) => void,
): NotificationTransport {
  return {
    id: capability.terminal === 'warp' ? 'terminal.warp-osc777' : `terminal.${capability.protocol}`,
    channel: 'terminal',
    capabilities: new Set(),
    deliver(envelope) {
      write(encodeTerminalNotification(capability, envelope))
    },
  }
}
