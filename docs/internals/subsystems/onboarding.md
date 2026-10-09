# Onboarding subsystem

Onboarding is the dedicated `/setup` route that selects a provider connection and default chat model
through the workspace model browser. Use this page when changing first-run routing, wizard state,
provider selection, OAuth return behavior, or completion storage.

## Terminology

| Term              | Meaning                                                           | Boundary                                                            |
| ----------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| Step registry     | Ordered `ONBOARDING_STEPS` entries with labels and components     | It is the only list that defines wizard order                       |
| Current step      | The step displayed by `OnboardingWizard`                          | Persisted by step id; an unknown id resumes at the first step       |
| Furthest step     | Highest step index reached through forward navigation             | Users can jump only to visited indexes                              |
| Wide step         | A step opting into a near-full-width column via `wide`            | Its rail labels collapse to hover so content is not overprinted     |
| Remembered pair   | Project connection id and model id inherited by new chat sessions | It is not an authentication or inference check                      |
| Completion marker | `uiSettings.onboardingCompletedAt`                                | Its presence suppresses the first-run redirect after settings sync  |
| Replay            | Normal navigation from System to `/setup`                         | Replay does not clear the existing completion marker before opening |

## What you can do

| Operation                    | Mechanism                                                            | Boundary                                                          |
| ---------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Add or reorder a wizard step | Change the `ONBOARDING_STEPS` registry                               | Rails, progress text, and active rendering derive from this array |
| Reuse provider configuration | `ProviderStep` embeds the workspace `ModelBrowser`                   | Do not add an onboarding-only provider or model catalogue         |
| Widen a cramped step         | Set `wide` on the registry entry; the shell drops its side padding   | Widen the container, never fork the shared browser's chrome       |
| Resume an OAuth return       | Current and furthest step ids persist in tab-scoped `sessionStorage` | Storage failure returns the wizard to Welcome after a full reload |
| Seed the first chat route    | Continue awaits a project-settings patch for the selected pair       | The selected connection must currently report key material        |
| Finish without a model       | Welcome skip, Provider skip, and the Ready fallback reach `finish`   | Completion does not guarantee a runnable provider                 |
| Replay setup                 | System navigates to the existing `/setup` route                      | The same provider, model, and settings APIs remain authoritative  |

The user workflow and its visible controls belong to
[Set up a provider and model](../../features/onboarding.md).

## How it works

### Registry and navigation

The registry currently contains three steps:

| Index | Step id    | Component      | Local responsibility                                        |
| ----: | ---------- | -------------- | ----------------------------------------------------------- |
|     0 | `welcome`  | `WelcomeStep`  | Introduce setup and enter or skip the flow                  |
|     1 | `provider` | `ProviderStep` | Connect a provider and choose the Chat model route (`wide`) |
|     2 | `ready`    | `ReadyStep`    | Report the remembered pair and finish or return to Provider |

A choice earns a step only when it must be made before the first session and cannot be discovered
later. Appearance was a step and is not one now: the application ships dark, light, and system,
switched from one control in the workspace.

Each entry carries `title`, `description`, and `icon`; the rail renders all three for the current
step. A step marked `wide` gets a `min(1440px, 96vw)` column and loses the shell's wide side
padding, so the embedded model browser has room after its fixed panes; the rail then shows ticks
only, with labels on hover over a backdrop, because a wide step's content runs beneath it.

Every step owns its own primary action through the shared `StepActions` block. The shell
deliberately has no global footer — a previous attempt at one read as foreign chrome and left steps
looking empty.

`OnboardingWizard` owns current-step state, furthest-step state, backward navigation, guarded jumps,
focus placement, and completion. Escape moves back one step. The desktop rail and mobile bar receive
the same registry and the same visited-step gate.

`onboardingProgress.ts` stores both positions in `sessionStorage` as step **ids**. This allows a
provider OAuth flow to reload the page and remount the Provider step, where the shared connection
code completes the return. Ids rather than indexes: a position written by a build with a different
registry would otherwise resume on an unrelated step, which for the OAuth return means landing away
from Provider and dropping the sign-in. An unrecognized id (renamed, removed, or a legacy numeric
value) resolves to the first step. Finishing or skipping clears both keys before writing the
completion timestamp.

Steps are never elided from the resolved list for the same reason: removing one shifts the resumed
position and the OAuth-completion handler would not mount.

### Shared provider browser

`ProviderStep` refreshes the shared connection store for direct `/setup` visits. It resolves the
remembered pair only when the connection still exists and reports `hasApiKey`, then passes the full
connection state and model catalogue to `ModelBrowser`.

`ModelBrowser` owns search, connection creation and removal, OAuth and API-key forms, workload
routing, filtering, favorites, and reasoning controls. The onboarding wrapper owns only the Chat
route selection, remembered-pair writes, Continue action, and environment-detected provider
shortcut.

`useProviderPick` prefers this mount's selected pair, then the startup project's stored pair, and
accepts either only while its connection reports `hasApiKey`. It does not call the catalog
recommendation helper or render a recommendation summary. `startupProject` chooses the default
project, falling back to the first project. The wrapper loads projects for direct setup visits.
Continue returns without advancing if that project is not loaded; otherwise it awaits
`saveStartupModel`, hydrates the updated project, and advances. Failure shows a retry message. The
patch contains only `providerConnectionId` and `modelId`, not reasoning effort.

`ModelBrowser` initializes its sidebar once per mount, so the wrapper latches the provider to open
on (the environment connect, else the provider of the most recently added connection with key
material) and keys the browser by it. The latch is set once: a connection added later must not
remount the pane under the user, and the browser already jumps to a connection it just created.

### Completion and routing

`ReadyStep` refreshes connections and checks for a non-empty project model id plus a matching
connection id. It does not call the provider or verify that the model remains available. It reads
back the connection and model through `ReadySummary`, where each row links to the Provider step that
owns it. A missing pair can jump back to that already visited step or finish explicitly without a
model.

After settings bootstrap completes, `RootLayout` redirects to `/setup` only when the completion
marker is absent and the current path is not already setup. `SetupPage` replaces the route with `/`
when the wizard exits.

There is no onboarding service or `/rpc/onboarding` endpoint. The feature uses shared settings,
project-settings, provider-connection, model-catalogue, and browser-storage seams. Completion
updates UI settings optimistically and exits without awaiting their server synchronization.

## Configuration

| State or control                        | Owner                                       | Effect                                                      |
| --------------------------------------- | ------------------------------------------- | ----------------------------------------------------------- |
| `uiSettings.onboardingCompletedAt`      | Backend-synchronized UI settings            | Suppresses first-run redirection after settings synchronize |
| `project.settings.providerConnectionId` | Server-persisted project settings           | Supplies the project connection default                     |
| `project.settings.modelId`              | Server-persisted project settings           | Supplies the project model default                          |
| `localix_onboarding_step`               | Onboarding progress in tab `sessionStorage` | Step id restoring the current step after a full-page return |
| `localix_onboarding_furthest`           | Onboarding progress in tab `sessionStorage` | Step id restoring the visited-step navigation gate          |
| **Replay setup**                        | System navigation                           | Opens `/setup` without changing completion state            |

## Limits

- Ready state is structural. It checks a remembered model string and a matching connection record;
  it does not test credentials, provider reachability, quota, or inference.
- Onboarding can record completion without a provider or model. Skipping retains any existing
  project pair; session or agent choices can also supply the first chat model.
- The Localix server stores project defaults. Tab-scoped browser storage owns wizard progress; the
  flow does not synchronize progress between browser profiles.
- The wizard configures a provider connection and a chat model but no appearance, typography,
  shortcut, profile, plugin, skill, workbench, agent, MCP, or channel state. Those features retain
  their own settings and installation flows.
- Only the Chat route is committed by Continue. The browser's other workload routes write as they
  change, so skipping a step does not roll them back.
- Onboarding does not scan foreign application homes. Environment-detected provider credentials use
  the shared provider connection flow; explicit MCP import remains outside this subsystem.
- If `sessionStorage` is unavailable, progress writes become no-ops. A full-page OAuth return then
  remounts at Welcome, so the Provider completion handler is not active until that step opens again.
- Replay is not a reset. The completion timestamp stays set, and exiting the replay writes a newer
  timestamp.

## Related guides

- [Set up a provider and model](../../features/onboarding.md)
- [Providers and credentials](../../features/providers.md)
- [Your first session](../../getting-started/first-session.md)

## Source of truth

- [Route shell](../../../apps/ui/src/pages/setup/SetupPage.tsx)
- [Step registry](../../../apps/ui/src/features/onboarding/model/steps.ts)
- [Navigation and completion](../../../apps/ui/src/features/onboarding/ui/OnboardingWizard.tsx)
- [Tab-scoped progress](../../../apps/ui/src/features/onboarding/model/onboardingProgress.ts)
- [Provider wrapper](../../../apps/ui/src/features/onboarding/ui/steps/ProviderStep.tsx)
- [Selection derivation](../../../apps/ui/src/features/onboarding/ui/steps/useProviderPick.ts)
- [Readiness check](../../../apps/ui/src/features/onboarding/ui/steps/ReadyStep.tsx)
- [Project startup model](../../../apps/ui/src/features/onboarding/model/startupModel.ts)
- [First-run redirect](../../../apps/ui/src/app/RootLayout.tsx)
- [Replay action](../../../apps/ui/src/features/settings/ui/SetupSection.tsx)
- [Environment-detected credentials](../../../apps/api/src/features/provider-connections/env-detect.ts)
