// Native windows share account preferences. Broadcast only committed writes;
// optimistic localStorage caches must never make another window read stale server state.

const CHANNEL = 'localix-profile-committed'

function workspaceId(): string | undefined {
  return typeof window !== 'undefined' ? window.__LOCALIX_WORKSPACE?.id : undefined
}

export function announceNativeSettingsSaved(): void {
  const source = workspaceId()
  if (!source || typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(CHANNEL)
  channel.postMessage(source)
  channel.close()
}

export function installNativeSettingsSync(sync: () => Promise<unknown>): () => void {
  const source = workspaceId()
  if (!source) return () => {}
  let stopped = false
  let running = false
  let dirty = false
  const refresh = async () => {
    dirty = true
    if (running) return
    running = true
    try {
      while (dirty && !stopped) {
        dirty = false
        await sync()
      }
    } catch (error) {
      console.warn('[settings] native workspace sync failed', error)
    } finally {
      running = false
    }
  }
  const onFocus = () => void refresh()
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL)
  if (channel)
    channel.onmessage = ({ data }) => {
      if (data !== source) void refresh()
    }
  window.addEventListener('focus', onFocus)
  return () => {
    stopped = true
    channel?.close()
    window.removeEventListener('focus', onFocus)
  }
}
