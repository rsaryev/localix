import { AlertTriangle, Blocks, PanelRight, Settings2 } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { SectionLabel } from '@localixai/kit/section-label'
import {
  WorkbenchListRow,
  WorkbenchListRowActions,
  WorkbenchListRowLeading,
  WorkbenchListRowMeta,
  WorkbenchListRowText,
  WorkbenchListRowTrigger,
} from '@localixai/kit/workbench-list-row'
import type { ModPaneRef, ModSummary } from '@/shared/api/modsApi'

/**
 * The Mods view's list: the panes mods opened, each with the mod and the project it belongs to,
 * then the installed mods — what each hooks, or why it did not load — with its plugin settings a
 * click away.
 */

/** The last folder of a project path: which project a pane belongs to, at a glance. */
export const projectOf = (cwd: string | null) =>
  cwd
    ?.split(/[\\/]/)
    .reverse()
    .find((part) => part !== '') ?? ''

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`

/** What a running mod does, in one line: its events, its panes, whether it draws. */
function hooksLine(mod: ModSummary) {
  return [
    plural(mod.events.length, 'event'),
    ...(mod.panes > 0 ? [plural(mod.panes, 'pane')] : []),
    ...(mod.draws ? ['draws'] : []),
  ].join(' · ')
}

export function PaneRows(props: {
  panes: readonly ModPaneRef[]
  selected: ModPaneRef | null
  onSelect: (pane: ModPaneRef) => void
}) {
  return (
    <section aria-label="Panes" className="flex flex-col gap-px">
      <SectionLabel className="px-2.5 pb-1">Panes</SectionLabel>
      {props.panes.length === 0 && (
        <p className="px-2.5 py-1 text-xs text-text-faint">No pane open</p>
      )}
      {props.panes.map((pane) => {
        const active = pane === props.selected
        const where = [pane.plugin, projectOf(pane.cwd)].filter(Boolean).join(' · ')
        return (
          <WorkbenchListRow key={`${pane.instance}/${pane.id}`} density="default" active={active}>
            <WorkbenchListRowTrigger
              aria-current={active ? 'true' : undefined}
              title={pane.cwd ?? undefined}
              onClick={() => props.onSelect(pane)}
            >
              <WorkbenchListRowLeading>
                <PanelRight className="size-3.5" />
              </WorkbenchListRowLeading>
              <WorkbenchListRowText title={pane.title ?? pane.id} description={where} />
            </WorkbenchListRowTrigger>
          </WorkbenchListRow>
        )
      })}
    </section>
  )
}

export function ModRows(props: {
  mods: readonly ModSummary[]
  onOpenSettings: (plugin: string) => void
}) {
  return (
    <section aria-label="Installed mods" className="flex flex-col gap-px">
      <SectionLabel className="px-2.5 pb-1">Installed mods</SectionLabel>
      {props.mods.map((mod) => {
        const failed = mod.status === 'failed'
        return (
          <WorkbenchListRow key={mod.plugin} density="default" className="pl-2.5">
            <WorkbenchListRowLeading className={failed ? 'text-destructive' : undefined}>
              {failed ? <AlertTriangle className="size-3.5" /> : <Blocks className="size-3.5" />}
            </WorkbenchListRowLeading>
            <WorkbenchListRowText
              className="pl-1 pr-1"
              title={
                <>
                  {mod.plugin}{' '}
                  {mod.version && <WorkbenchListRowMeta>{mod.version}</WorkbenchListRowMeta>}
                </>
              }
              description={
                failed ? (
                  <span className="text-destructive" title={mod.problem}>
                    {mod.problem ?? 'Did not load'}
                  </span>
                ) : (
                  hooksLine(mod)
                )
              }
            />
            <WorkbenchListRowActions aria-label={`${mod.plugin} actions`} visibility="hover">
              <IconButton
                size="sm"
                aria-label={`${mod.plugin} settings`}
                onClick={() => props.onOpenSettings(mod.plugin)}
              >
                <Settings2 />
              </IconButton>
            </WorkbenchListRowActions>
          </WorkbenchListRow>
        )
      })}
    </section>
  )
}
