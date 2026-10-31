/**
 * Read a cmdk item's highlighted `value`, which carries two shapes:
 *  - single-connection rows (`ModelListItem`): `value = modelId`
 *  - cross-connection rows (`CrossConnectionModelList`): `value = "<connectionId> <modelId>"`
 *
 * Neither a connection id (uuid) nor a catalog model id contains a space, so the model id is
 * always the last space-separated token. cmdk trims the value; a blank value (no highlight) maps
 * to null. Cross-connection rows keep their connection identity.
 */
export function modelRefFromCmdkValue(
  value: string | undefined | null,
): { connectionId?: string; modelId: string } | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const spaceIdx = trimmed.lastIndexOf(' ')
  return spaceIdx === -1
    ? { modelId: trimmed }
    : { connectionId: trimmed.slice(0, spaceIdx), modelId: trimmed.slice(spaceIdx + 1) }
}
