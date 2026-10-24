import { expect, test } from 'bun:test'

import { surfaceOf } from './surface.mjs'

// A declaration file in the layout Claude Code's mod types use, written for this test: what the
// extractor keeps is names — events, their input fields, `$` namespaces and methods, render sites
// and their props — and never a comment, a type or any other text.
const DECLARATIONS = `
declare module 'claude-code' {
  /** Commentary that must never reach a surface: SECRET. */
  export type ToolCallInput = { tool: string; tool_use_id: string } & ToolCommon;
  type ToolCommon = {
    /** a comment */
    readonly cwd?: string;
  };
  export type TurnInput = Omit<TurnFull, 'internal'>;
  type TurnFull = { turnId: string; internal: number; 'quoted-key': boolean };
  export type EngineEventOf = {
    /** Fires when SECRET. */
    'tool.call': ToolCallInput;
    'turn.start': TurnInput;
    'session.start': { cwd: string; surface: RenderSurface };
  };
  export interface CoreEngineInterface {
    ui: {
      /** @example $.ui.open({ id }) */
      open: (pane: PaneOpenArgs) => Promise<UiOpenResult>;
      log(text: string): void;
    };
    fs: FsApi;
  }
  type FsApi = { read: (path: string) => Promise<string>; exists: (path: string) => Promise<boolean> };
  export type RenderPropsOf = {
    Spinner: { word: string; suffix?: string };
    Pane: PaneProps & { view: unknown };
  };
  type PaneProps = { title: string; isFocused: boolean };
}
`

test('the surface lists the identifiers the declarations name, sorted, and no other text', () => {
  const surface = surfaceOf(DECLARATIONS)
  expect(surface).toEqual({
    events: {
      'session.start': ['cwd', 'surface'],
      'tool.call': ['cwd', 'tool', 'tool_use_id'],
      'turn.start': ['quoted-key', 'turnId'],
    },
    api: { fs: ['exists', 'read'], ui: ['log', 'open'] },
    renderSites: { Pane: ['isFocused', 'title', 'view'], Spinner: ['suffix', 'word'] },
  })
  expect(JSON.stringify(surface)).not.toContain('SECRET')
})

test('a declaration file without the expected maps says so instead of answering empty', () => {
  expect(() => surfaceOf('declare module "claude-code" {}')).toThrow('EngineEventOf')
})
