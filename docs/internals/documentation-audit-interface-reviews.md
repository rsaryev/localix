# Documentation audit: interface procedures

Follow-up evidence for practical interface instructions. This record complements the
[main audit](documentation-audit.md) and
[maintenance reviews](documentation-audit-maintenance-reviews.md). Source comparisons and synthetic
tests are distinguished from live product evidence.

## Vault entry point and item lifecycle

Compared the Vault rail contribution, current settings-tab registry, item/menu/dialog controls,
copy-reference handler, deletion hook and registered binding store. Removed the nonexistent Settings
→ Capabilities → Secrets route from the public guide. Added the actual create/rotate sequence,
managed-item menu restrictions and cleared-value retry behavior.

Qualified deletion as local item/version removal rather than provider revocation or removal of
external copies. Bindings come from registered consumer rows, not arbitrary file or external-system
discovery. An empty list cannot prove that no consumer uses the alias.

Six existing tests passed: the global restorable Vault contribution, rotation and deletion dialog
feedback, create-only conflict, stale-version refusal and registered-binding deletion protection.
The dialog tests mock API operations; the store tests use in-memory databases, synthetic values and
a plaintext fixture cipher. They verify lifecycle guards rather than encrypted storage. Clearing
after a failed save, managed menu omissions and clipboard reference content were checked in source.
No personal Vault or its master key, real credential, provider call or clipboard was accessed.
Relevant history includes `a00fef1`, `823a1af` and `ed1ab8d`; the first commit's GitHub comment
endpoint returned HTTP 422, so its remote feedback remains unverified. The other comment checks are
recorded in preceding reviews.

Affected document validation and public generation passed: 77 pages and 37 current captures from 48
dated assets. This update changes instructions, not Vault runtime behavior.

## Settings map and remaining Vault route

Removed the remaining retired Secrets settings path from the REST bundled skill. Compared the
application settings map with navigation, capability agent selection, alert suppression and usage
aggregation. Corrected unconditional default-assistant selection and the claim that subscription
cost is always excluded. Added picker/fallback guidance and mixed-session alert behavior, with links
to the owning Vault and cost guides.

Eight focused existing tests passed for mixed provenance, threshold/dismissal behavior and alert-row
presentation. A synthetic server-rendered component probe additionally confirmed that subscription
cost hides the strip while the same above-threshold estimated cost shows it. Agent selection was
checked in source; this does not establish live settings navigation, a server save or provider
billing. Relevant history includes `7d384c8` and `ed1ab8d`, whose feedback checks are recorded
previously.

Affected checks and generation passed: 77 pages, 37 current captures from 48 dated assets. Native
signing succeeded for the five-file intermediate checkpoint `99a6795`; earlier audit changes remain
staged separately.

## Signed checkpoints after signing recovered

Reviewed the current diffs before committing three previously verified changes. Native signing and
the applicable pre-commit formatting/lint checks passed. Existing runtime/capture evidence is
recorded in maintenance reviews; creating a checkpoint does not add new product coverage.

| Checkpoint | Result                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------ |
| `d16de40`  | Generator validates heading IDs through the shared renderer extractor, with regression coverage. |
| `6c7855d`  | Current hero/participant captures and their owning scenario/assertions are committed.            |
| `1ff800f`  | Shortcut procedures and notification handoff/terminal boundaries are committed.                  |

The screenshot checkpoint stores native 3× images; it does not prove a model run or completed
onboarding. Remaining guide edits and source-aligned content reviews are still separate audit work.

## README and public guide checkpoint

Reviewed README, the documentation index, first-session/overview changes, attachments, sandboxed
HTML views and their two navigation entries as one seven-file checkpoint. Checked its projected HEAD
rather than assuming other staged guides were already committed: 193 owned Markdown files had no
invalid inline heading anchors, and added Markdown targets resolved in that projection. This does
not validate external URLs or every HTML anchor. Affected readability/source checks passed, and
native signing created `06b787a`. The generation evidence remains the preceding 77-page run;
committing unchanged content does not require another generation.

## Related guides

- [Vault user guide](../features/secrets.md)
- [Documentation standards](doc-standards.md)
