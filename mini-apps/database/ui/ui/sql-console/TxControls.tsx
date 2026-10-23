/** Manual-transaction controls in the run bar: the Tx Auto/Manual toggle + the
 *  Commit/Rollback actions (shown in Manual mode only). */
import { Check, Undo2 } from 'lucide-react'
import type { SqlConsoleState } from '../../model/useSqlConsole'
import { ConsoleToolButton } from '../consoleActions'

export function TxControls({ c }: { c: SqlConsoleState }) {
  return (
    <>
      <span
        className="text-2xs font-medium text-text-faint"
        title="Transaction mode. Auto: every statement you run is saved immediately. Manual: your statements share one open transaction — nothing is saved until you Commit (or discard all with Rollback)."
      >
        Tx
      </span>
      {/* Two pressed-state buttons on the bar's own xs rung. The SDK segmented track only comes
          at the 32px rung; squeezed to 28/24 it still stood taller than every other control in
          this 20px row, so the bar's height jumped whenever transactions were shown. */}
      <div
        role="group"
        aria-label="Transaction mode"
        title={
          c.txOpen
            ? 'Commit or roll back the open transaction to switch back to Auto'
            : 'Auto: each statement commits · Manual: statements share one transaction'
        }
        className="flex items-center gap-0.5"
      >
        {(['auto', 'manual'] as const).map((mode) => (
          <ConsoleToolButton
            key={mode}
            aria-pressed={c.txMode === mode}
            onClick={() => c.setTxMode(mode)}
            className={c.txMode === mode ? 'bg-surface-active text-foreground' : undefined}
          >
            {mode === 'auto' ? 'Auto' : 'Manual'}
          </ConsoleToolButton>
        ))}
      </div>
      {/* Commit/Rollback only make sense in Manual mode — hide them in Auto so they
          aren't mystery buttons. Enabled once a transaction is actually open. */}
      {c.txMode === 'manual' && (
        <>
          <ConsoleToolButton
            onClick={() => void c.commitTx()}
            disabled={!c.txOpen || c.txBusy}
            title="Commit — save everything done in the open transaction"
            className="hover:text-status-success"
          >
            <Check className="size-3" />
            Commit
          </ConsoleToolButton>
          <ConsoleToolButton
            onClick={() => void c.rollbackTx()}
            disabled={!c.txOpen || c.txBusy}
            title="Rollback — discard everything done in the open transaction"
            className="hover:text-status-error"
          >
            <Undo2 className="size-3" />
            Rollback
          </ConsoleToolButton>
        </>
      )}
      <div className="h-4 w-px bg-border/60" />
    </>
  )
}
