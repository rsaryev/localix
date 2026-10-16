import type { SecretBinding, SecretMeta } from '@localixai/api/client'
import { DIVIDED_LIST } from '@localixai/kit/divided-list'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { VAULT_TYPE_PRESENTATION } from '../model/vaultTypePresentation'

export function VaultUsageView({
  items,
  bindingsByKey,
  loading,
}: {
  items: SecretMeta[]
  bindingsByKey: Record<string, SecretBinding[]>
  loading: boolean
}) {
  if (loading) {
    return <LoadingHint className="py-16 text-xs">Mapping Vault consumers</LoadingHint>
  }
  const used = items.filter((item) => (bindingsByKey[item.key]?.length ?? 0) > 0)
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <div className="grid gap-3">
        <header className="border-b border-border-faint pb-3">
          <h2 className="text-sm font-medium">Consumer map</h2>
          <p className="mt-1 max-w-2xl text-xs/relaxed text-text-soft">
            Usage metadata contains item IDs, aliases and consumer names only. Values, headers,
            request bodies and query strings are never recorded.
          </p>
        </header>
        {used.length === 0 ? (
          <EmptyHint className="py-14 text-xs">No registered consumers yet.</EmptyHint>
        ) : (
          <div className={DIVIDED_LIST}>
            {used.map((item) => {
              const ItemIcon = VAULT_TYPE_PRESENTATION[item.type].Icon
              return (
                <section key={item.id} className="py-3">
                  <div className="flex items-center gap-2">
                    <ItemIcon
                      aria-hidden="true"
                      className="size-3.5 text-text-soft"
                      strokeWidth={1.75}
                    />
                    <span className="font-medium">{item.label}</span>
                    <code className="ml-auto font-mono text-xs text-text-faint">{item.key}</code>
                  </div>
                  <div className="mt-2 divide-y divide-border-faint border-t border-border-faint">
                    {bindingsByKey[item.key]?.map((binding) => (
                      <div
                        key={`${binding.consumerType}:${binding.consumerId}:${binding.field}`}
                        className="flex items-center gap-2 py-2 text-xs"
                      >
                        <span
                          aria-hidden="true"
                          className="size-1.5 shrink-0 rounded-full bg-status-success"
                        />
                        <span className="truncate">{binding.label || binding.consumerId}</span>
                        <code className="ml-auto shrink-0 font-mono text-2xs text-text-faint">
                          {binding.consumerType}
                        </code>
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
