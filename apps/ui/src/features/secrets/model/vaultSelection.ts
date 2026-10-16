type VaultSelectableItem = {
  key: string
}

export function selectionAfterVaultRefresh(
  items: readonly VaultSelectableItem[],
  currentKey: string | null,
  requestedKey?: string,
): string | null {
  if (requestedKey && items.some((item) => item.key === requestedKey)) return requestedKey
  if (currentKey && items.some((item) => item.key === currentKey)) return currentKey
  return null
}

export function toggleVaultSelection(currentKey: string | null, clickedKey: string): string | null {
  return currentKey === clickedKey ? null : clickedKey
}
