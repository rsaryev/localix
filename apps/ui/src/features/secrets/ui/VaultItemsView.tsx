import { GripVertical, KeyRound, Plus, Search } from 'lucide-react'
import type { SetStateAction } from 'react'

import { VAULT_ITEM_TYPE_DEFINITIONS, VAULT_ITEM_TYPES } from '@localixai/api/vault-item-types'
import type { SecretMeta, VaultVersionMeta } from '@localixai/api/client'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import {
  setMessageBindingDrag,
  type MessageBindingDragPayload,
} from '@localixai/plugin-sdk/ui/message-binding-drag'
import { Button } from '@localixai/kit/button'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { SearchInput } from '@localixai/kit/search-input'
import { FilterMenu, type FilterOption } from '@/shared/ui/FilterMenu'
import { ProblemState, type OwnedProblemReport } from '@/shared/ui/problem-report'
import { StateNotice } from '@localixai/kit/state-notice'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import type { SourceFilter, TypeFilter } from '../model/vaultSections'

import { toggleVaultSelection } from '../model/vaultSelection'
import { VAULT_TYPE_PRESENTATION } from '../model/vaultTypePresentation'
import { ItemMetadata, VaultItemDetails } from './VaultItemDetails'
import { vaultItemMenu } from './vaultItemMenu'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'

const TYPE_OPTIONS: readonly FilterOption<TypeFilter>[] = [
  { value: 'all', label: 'All types' },
  ...VAULT_ITEM_TYPES.map((value) => ({
    value,
    label: VAULT_ITEM_TYPE_DEFINITIONS[value].label,
    icon: VAULT_TYPE_PRESENTATION[value].Icon,
  })),
]
const SOURCE_OPTIONS: readonly FilterOption<SourceFilter>[] = [
  { value: 'all', label: 'All sources' },
  { value: 'user', label: 'Personal' },
  { value: 'provider', label: 'Providers' },
  { value: 'plugin', label: 'Plugins' },
  { value: 'system', label: 'System' },
]

export function VaultItemsView({
  items,
  loading,
  loadFailed,
  problem,
  filtered,
  query,
  setQuery,
  typeFilter,
  setTypeFilter,
  sourceFilter,
  setSourceFilter,
  selected,
  selectedKey,
  setSelectedKey,
  setEditor,
  bindTarget,
  bindingFor,
  copied,
  copyReference,
  beginDelete,
  versionsByKey,
  loadingVersions,
}: {
  items: SecretMeta[]
  loading: boolean
  loadFailed: boolean
  problem: OwnedProblemReport | null
  filtered: SecretMeta[]
  query: string
  setQuery: (value: string) => void
  typeFilter: TypeFilter
  setTypeFilter: (value: TypeFilter) => void
  sourceFilter: SourceFilter
  setSourceFilter: (value: SourceFilter) => void
  selected: SecretMeta | undefined
  selectedKey: string | null
  setSelectedKey: (value: SetStateAction<string | null>) => void
  setEditor: (value: SetStateAction<'create' | 'edit' | 'rotate' | null>) => void
  bindTarget: (key: string, element: HTMLButtonElement | null) => void
  bindingFor: (item: SecretMeta) => MessageBindingDragPayload
  copied: string | null
  copyReference: (item: SecretMeta, template?: boolean) => Promise<void>
  beginDelete: (item: SecretMeta) => Promise<void>
  versionsByKey: Record<string, VaultVersionMeta[]>
  loadingVersions: boolean
}) {
  return (
    <>
      {/* The search flexes and ONE quiet "Filter" menu holds both narrowings. Two framed
          selects used to share the row, and a side panel landed on a different accidental
          layout at every pane width; a single trigger fits beside the search at any width. */}
      <WorkbenchToolbar aria-label="Vault filters">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search names, aliases, tags…"
          className="min-w-0 flex-1"
        />
        <FilterMenu
          label="Filter items"
          className="shrink-0"
          facets={[
            {
              id: 'type',
              label: 'Type',
              value: typeFilter,
              allValue: 'all',
              options: TYPE_OPTIONS,
              onChange: setTypeFilter,
            },
            {
              id: 'source',
              label: 'Source',
              value: sourceFilter,
              allValue: 'all',
              options: SOURCE_OPTIONS,
              onChange: setSourceFilter,
            },
          ]}
        />
      </WorkbenchToolbar>

      <div className="flex min-h-0 flex-1 flex-col @4xl:flex-row">
        <div data-ui-scroll-container className="flex min-w-0 flex-1 flex-col overflow-auto">
          {loading ? (
            <LoadingHint>Opening encrypted Vault</LoadingHint>
          ) : loadFailed ? (
            problem && <ProblemState {...problem} />
          ) : filtered.length === 0 ? (
            <StateNotice
              icon={query || typeFilter !== 'all' || sourceFilter !== 'all' ? Search : KeyRound}
              title={items.length ? 'No matching items' : 'Your Vault is empty'}
              body={
                items.length
                  ? 'Change the search or filters to see more items.'
                  : 'Add a secret once, then let agents and plugins use its alias without seeing the value.'
              }
              actions={
                items.length ? undefined : (
                  <Button onClick={() => setEditor('create')}>
                    <Plus className="size-3.5" />
                    Add first item
                  </Button>
                )
              }
              actionsLabel="Vault setup actions"
            />
          ) : (
            <div className="divide-y divide-border-faint">
              {filtered.map((item) => {
                const presentation = VAULT_TYPE_PRESENTATION[item.type]
                const Icon = presentation.Icon
                const active = item.key === selectedKey
                return (
                  <ContextMenu key={item.id}>
                    <ContextMenuTrigger asChild>
                      <button
                        ref={(element) => bindTarget(item.key, element)}
                        type="button"
                        draggable
                        title="Click for details or drag to chat to link metadata"
                        onDragStart={(event) => {
                          const binding = bindingFor(item)
                          // The alias token — never the secret — is the text fallback
                          // for a drop that lands outside the composer.
                          setMessageBindingDrag(event.dataTransfer, binding, {
                            plainText: binding.target.token,
                          })
                        }}
                        onClick={() =>
                          setSelectedKey((current) => toggleVaultSelection(current, item.key))
                        }
                        aria-expanded={active}
                        aria-controls={active ? 'vault-item-details' : undefined}
                        className={cn(
                          // The hover/active veil pair, not `bg-accent/10`: `accent` is itself a 6%
                          // veil under glass, so `/10` of it was a 0.6% fill — the SELECTED row read
                          // weaker than a plain hover. 11% is the canonical "this one is selected".
                          'grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-2 px-3 py-2.5 text-left outline-none transition-colors focus-visible:bg-surface-hover @sm:gap-3',
                          active ? 'bg-surface-active' : 'hover:bg-surface-hover',
                        )}
                      >
                        <span className="flex min-w-0 items-start gap-3">
                          <span className="mt-1 grid w-4 shrink-0 place-items-center">
                            <Icon
                              aria-hidden="true"
                              className="size-3.5 text-text-soft"
                              strokeWidth={1.75}
                            />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{item.label}</span>
                            <ItemMetadata item={item} detailed />
                          </span>
                        </span>
                        {/* The row is draggable as a whole; the grip is the affordance, and in a
                            narrow side panel it is the first thing worth its width. */}
                        <GripVertical
                          aria-hidden="true"
                          className="mt-1.5 hidden size-4 cursor-grab text-text-faint @sm:block active:cursor-grabbing"
                        />
                      </button>
                    </ContextMenuTrigger>
                    {/* The row's only behaviour was to select itself; every action lived in the
                      details pane that selection opens. Right-click reaches them in place. */}
                    <ContextMenuContent className="min-w-48">
                      <MenuEntries
                        entries={vaultItemMenu(item, {
                          copied,
                          onCopy: (target, template) => void copyReference(target, template),
                          onEdit: () => {
                            setSelectedKey(item.key)
                            setEditor('edit')
                          },
                          onRotate: () => {
                            setSelectedKey(item.key)
                            setEditor('rotate')
                          },
                          onDelete: () => void beginDelete(item),
                        })}
                        family="context"
                      />
                    </ContextMenuContent>
                  </ContextMenu>
                )
              })}
            </div>
          )}
        </div>

        {selected && (
          <aside
            id="vault-item-details"
            // Bottom sheet under the list until the pane is wide enough for a real second
            // column. `overflow-x` is not clipped here — the panel's own children wrap, which
            // is what keeps a long alias readable instead of merely hidden. The seam follows
            // the repo's chrome weight (the soft border step) rather than the `/50` it had invented.
            className="max-h-[45%] w-full min-w-0 shrink-0 overflow-y-auto border-t border-border-soft p-3 @sm:p-4 @4xl:max-h-none @4xl:w-88 @4xl:border-t-0 @4xl:border-l"
          >
            <VaultItemDetails
              item={selected}
              copied={copied}
              onCopy={(item, template) => void copyReference(item, template)}
              onClose={() => setSelectedKey(null)}
              onEdit={() => setEditor('edit')}
              onRotate={() => setEditor('rotate')}
              onDelete={() => void beginDelete(selected)}
              versions={versionsByKey[selected.key] ?? []}
              loadingVersions={loadingVersions}
            />
          </aside>
        )}
      </div>
    </>
  )
}
