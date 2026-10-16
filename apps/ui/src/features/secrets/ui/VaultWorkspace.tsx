import { KeyRound, Plus, RefreshCw, ScrollText, ShieldCheck } from 'lucide-react'

import { useVaultWorkspace } from '../model/useVaultWorkspace'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { SegmentedControl, SegmentedControlItem } from '@localixai/plugin-sdk/ui/segmented-control'
import { ProblemLine } from '@/shared/ui/problem-report'
import { Spinner } from '@localixai/kit/spinner'
import { WorkbenchToolbar, WorkbenchToolbarSection } from '@localixai/kit/workbench-toolbar'
import { WorkbenchStatusBar, WorkbenchStatusItem } from '@localixai/kit/workbench-statusbar'
import { VaultActivityView } from './VaultActivityView'
import { VaultDeleteDialog } from './VaultDeleteDialog'
import { VaultItemDialog } from './VaultItemDialog'
import { VaultItemsView } from './VaultItemsView'
import { VaultUsageView } from './VaultUsageView'

export function VaultWorkspace({ requestedKey }: { requestedKey?: string }) {
  const vault = useVaultWorkspace(requestedKey)

  // No ground coat: the hosting pane already paints one, and under the macOS glass theme the
  // ground tokens carry alpha — a second pane-sized coat compounds into an opaque slab.
  return (
    <div className="@container flex h-full min-h-0 flex-col text-foreground">
      <WorkbenchToolbar as="header" wrap aria-label="Vault controls">
        {/* `min-w-0` so the section switch shrinks with the pane instead of pushing the
            action cluster out of the header in a narrow side panel. */}
        <SegmentedControl variant="muted" aria-label="Vault sections" className="min-w-0">
          <SegmentedControlItem
            active={vault.section === 'items'}
            onClick={() => vault.setSection('items')}
          >
            <KeyRound className="size-3" />
            Items
          </SegmentedControlItem>
          <SegmentedControlItem
            active={vault.section === 'usage'}
            onClick={() => vault.setSection('usage')}
          >
            <ShieldCheck className="size-3" />
            Usage
          </SegmentedControlItem>
          <SegmentedControlItem
            active={vault.section === 'activity'}
            onClick={() => vault.setSection('activity')}
          >
            <ScrollText className="size-3" />
            Activity
          </SegmentedControlItem>
        </SegmentedControl>

        <WorkbenchToolbarSection align="end" aria-label="Vault actions">
          <IconButton
            size="sm"
            aria-label="Refresh Vault"
            tooltip="Refresh Vault"
            onClick={() => void vault.refresh(true)}
          >
            {vault.refreshing ? (
              <Spinner className="size-3.5" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
          </IconButton>
          <Button size="sm" onClick={() => vault.setEditor('create')}>
            <Plus className="size-3.5" />
            Add item
          </Button>
        </WorkbenchToolbarSection>
      </WorkbenchToolbar>

      {/* Four independent metrics, none of them expendable — so the bar WRAPS rather than
          clipping the last two the moment the Vault is opened in a side panel. */}
      <WorkbenchStatusBar aria-label="Vault summary" seam="bottom" wrap>
        {[
          ['Items', vault.items.length],
          ['Provider & plugin', vault.managedCount],
          ['Known consumers', vault.totalConsumers],
          ['Model-visible values', 0],
        ].map(([label, value]) => (
          <WorkbenchStatusItem key={label} className="gap-1.5">
            <span className="font-medium text-foreground tabular-nums">{value}</span>
            <span className="truncate">{label}</span>
          </WorkbenchStatusItem>
        ))}
      </WorkbenchStatusBar>

      {vault.problem && !vault.loadFailed && (
        <ProblemLine {...vault.problem} className="px-3 py-2" />
      )}

      {vault.section === 'items' ? (
        <VaultItemsView {...vault} />
      ) : vault.section === 'usage' ? (
        <VaultUsageView
          items={vault.items}
          bindingsByKey={vault.bindingsByKey}
          loading={vault.loadingUsage}
        />
      ) : (
        <VaultActivityView entries={vault.activity} loading={vault.loadingActivity} />
      )}

      <VaultItemDialog
        open={vault.editor !== null}
        mode={vault.editor ?? 'create'}
        item={vault.selected}
        onOpenChange={(open) => {
          if (!open) vault.setEditor(null)
        }}
        onSaved={vault.saveItem}
      />
      <VaultDeleteDialog
        open={vault.deleteTarget !== undefined}
        item={vault.deleteTarget}
        bindings={vault.deleteBindings}
        loadingBindings={vault.loadingDeleteBindings}
        deleting={vault.deleting}
        error={vault.deleteError}
        onOpenChange={(open) => {
          if (!open) vault.setDeleteTarget(undefined)
        }}
        onConfirm={(force) => void vault.confirmDelete(force)}
      />
    </div>
  )
}
