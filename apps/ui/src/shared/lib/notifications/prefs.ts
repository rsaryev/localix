import { create } from 'zustand'
import {
  parseNotificationPreferences,
  type NotificationCondition,
  type NotificationPreferences,
  type TerminalNotificationMethod,
} from '@localixai/notifications'
import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'

const LS_KEY = 'localix_notification_prefs_v1'

interface NotificationPrefs extends NotificationPreferences {
  /** Show the unread notification count as a native app-icon badge (dock on
   *  macOS / taskbar-adjacent on Linux). Default on. No-op outside the shell. */
  appIconBadge: boolean
}

interface PersistedNotificationPrefs extends NotificationPrefs {
  schemaVersion: 2
}

function load(): NotificationPrefs {
  const stored = loadJSON<unknown>(LS_KEY)
  const preferences = parseNotificationPreferences(stored)
  const appIconBadge =
    stored &&
    typeof stored === 'object' &&
    typeof (stored as Record<string, unknown>).appIconBadge === 'boolean'
      ? ((stored as Record<string, unknown>).appIconBadge as boolean)
      : true
  return { ...preferences, appIconBadge }
}

interface PrefsState extends NotificationPrefs {
  setCondition: (condition: NotificationCondition) => void
  setTerminalMethod: (terminalMethod: TerminalNotificationMethod) => void
  setAppIconBadge: (enabled: boolean) => void
}

function persist(get: () => PrefsState): void {
  const { condition, terminalMethod, appIconBadge } = get()
  saveJSON(LS_KEY, {
    schemaVersion: 2,
    condition,
    terminalMethod,
    appIconBadge,
  } satisfies PersistedNotificationPrefs)
}

export const useNotificationPrefs = create<PrefsState>((set, get) => ({
  ...load(),
  setCondition: (condition) => {
    set({ condition })
    persist(get)
  },
  setTerminalMethod: (terminalMethod) => {
    set({ terminalMethod })
    persist(get)
  },
  setAppIconBadge: (enabled) => {
    set({ appIconBadge: enabled })
    persist(get)
  },
}))

/** Non-React read for composition roots and the toast compatibility shim. */
export function notificationPreferences(): NotificationPreferences {
  const { condition, terminalMethod } = useNotificationPrefs.getState()
  return { condition, terminalMethod }
}
