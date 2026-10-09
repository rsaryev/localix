# Set up a provider and model

The `/setup` page connects a provider and chooses the default chat model for new desktop/web
sessions. It prepares a first session through the same model browser used later in the workspace.

## What you can do

| Step         | Mechanism                                                        | Boundary                                                      |
| ------------ | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| **Welcome**  | Continue to provider setup or finish setup immediately           | Provider setup is optional                                    |
| **Provider** | Create or select a provider connection, then choose a chat model | **Continue** requires a connection with key material          |
| **Ready**    | Review the connection and the chosen model                       | The check does not contact the provider or validate the model |

The Provider step also lists credentials detected in the Localix server environment. Connecting one
sends only its provider id; the server reads the key and creates an API-key connection without
returning the secret value to the client, then opens that provider's models.

## How it works

After settings synchronize, Localix redirects to `/setup` when `uiSettings.onboardingCompletedAt` is
absent. Finishing or skipping updates the timestamp locally, schedules settings synchronization,
clears tab-scoped wizard progress, and returns to the home route without waiting for that save.

The Provider step embeds the workspace `ModelBrowser`. It supplies provider and model search,
connection forms, recent and favorite models, filters, and workload routes without a separate
onboarding catalog. That step renders in a near-full-width column, because the browser's workload,
provider, and details panes claim a fixed width before the model list gets any. The step opens on
the provider of the most recently added connection with key material.

**Continue** saves the selected connection and model to the default project's settings, or the first
project when none is marked default. It waits for the save before advancing; a failed save keeps you
on Provider with a retry message. The project must have loaded before Continue can save. The step
uses your current choice or an existing project pair whose connection has key material; it does not
automatically recommend a model. New sessions inherit project settings when no higher-priority
session or agent model choice applies.

The shared browser also exposes other workload routes. Changes to those routes save immediately;
only the Chat selection controls the onboarding **Continue** button.

The Ready step checks for a non-empty project model id and a matching connection id, then lists the
connection and model with a link back to the Provider step that owns them. Current and
furthest-visited steps live in tab-scoped `sessionStorage` as step **ids**, so a full-page OAuth
return reopens the Provider step even across a release that reorders the steps; an unrecognized id
resumes at Welcome. Visited steps remain navigable, unseen steps stay locked, and Escape moves back
one step.

## Configuration

| State or control                                   | Storage or effect                                            |
| -------------------------------------------------- | ------------------------------------------------------------ |
| `uiSettings.onboardingCompletedAt`                 | Suppresses the first-run redirect after settings synchronize |
| `project.settings.providerConnectionId`            | Server-persisted project connection default                  |
| `project.settings.modelId`                         | Server-persisted project model default                       |
| `localix_onboarding_step`                          | Current step id in tab-scoped `sessionStorage`               |
| `localix_onboarding_furthest`                      | Furthest visited step id in tab-scoped `sessionStorage`      |
| **Settings → System → Application → Replay setup** | Opens `/setup` without clearing the completion timestamp     |
| **Skip setup for now**                             | Records completion and exits from Welcome                    |
| **Skip this step**                                 | Advances from Provider without choosing a model              |
| **Finish without a model**                         | Records completion from Ready without a runnable pair        |

## Limits

- **Ready to chat** is a structural check, not a credential or inference test. Authentication,
  quota, network access, disabled keys, or a stale model id can still fail on the first request.
- Onboarding can finish without a provider or model. Skipping does not change an existing project
  pair; a new session needs a usable model through the normal session, agent, or project defaults.
- The saved pair belongs to the default project, or the first loaded project when no default is
  present. Opening another project does not copy that pair; check the conversation's effective model
  before sending. Wizard progress belongs to the current browser tab.
- The wizard configures a provider and a chat model but not appearance, typography, shortcuts,
  profile, plugins, skills, workbenches, or channels.
- Only the Chat connection and model are committed by **Continue**, not the selected reasoning
  effort. The browser's other workload routes save as you change them, so skipping the step does not
  undo them.
- The wizard does not scan or import plugins, agents, skills, MCP configuration, or provider files
  from another application. Those artifacts use their owning installation or import flows.
- If `sessionStorage` is unavailable, a full-page OAuth return reopens at Welcome. The Provider
  completion handler is not mounted again until you advance to that step.

## Related guides

- [Installation](../getting-started/installation.md)
- [Your first session](../getting-started/first-session.md)
- [Providers and credentials](providers.md)

## Source of truth

- [Step registry](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/onboarding/model/steps.ts)
- [Wizard navigation](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/onboarding/ui/OnboardingWizard.tsx)
- [Tab-scoped progress](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/onboarding/model/onboardingProgress.ts)
- [Provider step](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/onboarding/ui/steps/ProviderStep.tsx)
- [Readiness check](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/onboarding/ui/steps/ReadyStep.tsx)
- [Project startup model](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/onboarding/model/startupModel.ts)
- [New-session defaults](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/chat/model/sessionActionsSlice.ts)
- [First-run redirect](https://github.com/rsaryev/localix/blob/main/apps/ui/src/app/RootLayout.tsx)
- [Environment-detected providers](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/provider-connections/env-detect.ts)
