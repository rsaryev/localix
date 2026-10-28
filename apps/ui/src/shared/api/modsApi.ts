import { client, unwrap } from './internal'

/** One element of a mod's drawing, as the server serializes it (`@localixai/claude-plugin/mods`). */
export interface ModElement {
  type:
    | 'Box'
    | 'Text'
    | 'Button'
    | 'Link'
    | 'Code'
    | 'Markdown'
    | 'Input'
    | 'Select'
    | 'Svg'
    | 'Client'
  props: Record<string, unknown>
  children: Array<ModElement | string>
  /** A `Client`'s surface module as the API built it: a new revision is new code. */
  client?: { revision: string }
}

/** A `Client`'s surface module, bundled for its frame, or why it did not build. */
export type ModClientModule = { module: string; revision: string } & (
  | { code: string }
  | { problem: string }
)

export type ModClientFault = { phase: 'load' | 'render' | 'run'; reason: string }

export interface ModPaneDrawing {
  /** The mod instance the pane belongs to: a mod runs once per project. */
  instance: string
  plugin: string
  id: string
  title?: string
  tree: Array<ModElement | string> | null
  problem?: string
}

/** An open pane: its mod instance, plugin and the project that instance runs in. */
export interface ModPaneRef {
  instance: string
  plugin: string
  id: string
  title?: string
  cwd: string | null
  /** Escape closes it while it holds the keyboard. */
  closeOnEscape: boolean
  /** Grows each time the mod asks for the keyboard (`$.ui.open({ focus })`). */
  focusRequest: number
}

/** One mod as its plugin's row in Settings lists it (`features/mods/summary.ts` on the API). */
export interface ModSummary {
  plugin: string
  version?: string
  /** The events its hooks module registered. */
  events: string[]
  /** Panes it has open. */
  panes: number
  /** Whether it draws on a render site: a pane or the band above the message box. */
  draws: boolean
  status: 'running' | 'failed'
  problem?: string
}

export interface ModsOverview {
  mods: ModSummary[]
  panes: ModPaneRef[]
  failures: Record<string, string>
}

/** A conversation's prompt box and status line as its mods left them. */
export interface ModSessionView {
  fills: Array<{ id: string; text: string; mode: 'replace' | 'append' | 'insert' }>
  suggestion: string | null
  statuses: Record<string, string>
}

/** One page of the band: what the chain drew from one mod on, and the mods that drew it. */
export interface ModBandPage {
  mods: string[]
  tree: Array<ModElement | string>
}

/** The band above a conversation's prompt box, as its mods draw it (`AbovePrompt`). */
export interface ModBandDrawing {
  sessionId: string
  /** The first page's tree. */
  tree: Array<ModElement | string> | null
  /**
   * Every page: the chain as Claude Code runs it first, then what each mod a drawing hid drew
   * (the API's `band-pages.ts`). Absent from an older API: the tree is the one page.
   */
  pages?: ModBandPage[]
  /** The chat's turn is running. */
  working?: boolean
  problem?: string
}

export type ModAction = {
  kind: 'press' | 'change' | 'submit' | 'select'
  element: string
  value?: string
}

/** Claude Code mods loaded here: their panes and the controls drawn in them (`/rpc/mods`). */
export const modsApi = {
  async overview(): Promise<ModsOverview> {
    return (await unwrap(await client.rpc.mods.$get())) as ModsOverview
  },
  async session(sessionId: string): Promise<ModSessionView> {
    return (await unwrap(
      await client.rpc.mods.sessions[':sessionId'].$get({ param: { sessionId } }),
    )) as ModSessionView
  },
  async taken(sessionId: string, taken: { fills?: string[]; suggestion?: boolean }) {
    await unwrap(
      await client.rpc.mods.sessions[':sessionId'].taken.$post({
        param: { sessionId },
        json: taken,
      }),
    )
  },
  async band(sessionId: string, columns: number, rows: number): Promise<ModBandDrawing> {
    return (await unwrap(
      await client.rpc.mods.sessions[':sessionId'].band.$get({
        param: { sessionId },
        query: { columns: String(columns), rows: String(rows) },
      }),
    )) as ModBandDrawing
  },
  /** A control used on the band's page `page` (each page is its own drawing). */
  async bandAct(sessionId: string, action: ModAction, page = 0): Promise<void> {
    await unwrap(
      await client.rpc.mods.sessions[':sessionId'].band.actions.$post({
        param: { sessionId },
        json: page === 0 ? action : { ...action, page },
      }),
    )
  },
  async pane(instance: string, id: string, columns: number): Promise<ModPaneDrawing> {
    return (await unwrap(
      await client.rpc.mods.panes[':instance'][':id'].$get({
        param: { instance, id },
        query: { columns: String(columns) },
      }),
    )) as ModPaneDrawing
  },
  async act(instance: string, id: string, action: ModAction): Promise<void> {
    await unwrap(
      await client.rpc.mods.panes[':instance'][':id'].actions.$post({
        param: { instance, id },
        json: action,
      }),
    )
  },
  async clientModule(instance: string, module: string): Promise<ModClientModule> {
    return (await unwrap(
      await client.rpc.mods.clients[':instance'].$get({ param: { instance }, query: { module } }),
    )) as ModClientModule
  },
  /** What a `Client` posted (`ui.message`); a hook may answer with its next props. */
  async message(
    instance: string,
    id: string,
    key: string,
    data: unknown,
  ): Promise<{ props?: unknown }> {
    return (await unwrap(
      await client.rpc.mods.panes[':instance'][':id'].clients[':key'].messages.$post({
        param: { instance, id, key },
        json: { data },
      }),
    )) as { props?: unknown }
  },
  async fault(instance: string, id: string, key: string, fault: ModClientFault): Promise<void> {
    await unwrap(
      await client.rpc.mods.panes[':instance'][':id'].clients[':key'].faults.$post({
        param: { instance, id, key },
        json: fault,
      }),
    )
  },
  async close(instance: string, id: string): Promise<void> {
    await unwrap(
      await client.rpc.mods.panes[':instance'][':id'].$delete({ param: { instance, id } }),
    )
  },
}
