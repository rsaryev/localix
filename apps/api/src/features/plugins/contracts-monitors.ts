/**
 * A Claude Code background monitor (experimental) as the kit read it, for the plugin's contents
 * rows: its name, its command as written, and the `description` shown in the task panel. When it
 * starts and how it runs are the chat's kit session's (`kit/monitors.ts`, `monitor-host.ts`).
 */
export interface PluginMonitor {
  name: string
  command: string
  description: string
}
