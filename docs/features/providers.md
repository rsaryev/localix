# Connect model providers

Use the model picker to connect a provider and choose the model for the current session. The same
connection path supplies chat and auxiliary model tasks.

**Availability:** Providers and models come from the active runtime catalog. API-key connections
need a catalog entry, and sign-in appears only when that runtime reports an OAuth flow.

![The provider picker showing OpenAI connection options before credentials are entered](../assets/screenshots/providers/model-browser--2026-10-08.png)

## What you can do

| Capability                | Mechanism                                                                                      | Boundary                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Connect with an API key   | Store a key from the model picker's provider form                                              | A provider must exist in the runtime catalog                         |
| Sign in through OAuth     | Start the interaction advertised by the runtime adapter                                        | Availability and interaction style depend on the provider definition |
| Keep separate connections | Add and label more than one connection for the same provider                                   | A session stores one preferred connection                            |
| Manage connection keys    | Add, remove, enable, or disable masked keys                                                    | Cannot remove the only key or disable the last enabled key           |
| Choose a session model    | Bind a catalog model and connection from the composer                                          | The model must belong to the connection's provider                   |
| Inspect model fit         | Compare capabilities, modalities, limits, wire protocol, and pricing including tiers           | Catalog records can be partial or change with the active runtime     |
| Narrow the model list     | Search models, or filter by tools, reasoning, vision, priced caching, or free                  | A facet appears only when some model in the list matches it          |
| Find a provider           | Search the provider column; it filters connections and providers to add                        | It never narrows the model list                                      |
| Choose reasoning effort   | Pick a level in the model details panel's Settings, remembered per agent and model             | A model that publishes none offers only "off"                        |
| Route auxiliary work      | Select model slots for session titles and inline completion                                    | Each unset route uses its documented fallback                        |
| Get new models            | The model list refreshes in the background; **Settings → System → Model list** checks now      | Only providers listed on models.dev                                  |
| Run models locally        | Connect **Local** (no key); picking a model downloads it — see [Local models](local-models.md) | The model runs on this computer's memory and processor               |

## How it works

Each participant's seat stores its model, connection, and reasoning effort explicitly; nothing is
inherited after the seat exists. The details panel shows the running model's stored level. For any
other model it shows the level that model would start at: the level last chosen for that agent on
that model, otherwise the default, limited to the levels the model supports. Every level change,
from the picker or the composer, is remembered for that agent and model.

The runtime adapter projects its provider definitions, text models, image models, authentication
methods, limits, modalities, and pricing into engine-neutral catalog records. The API caches that
projection, and the model browser groups models by live connections. Its workload column lets the
user choose what the next model assignment is for before choosing the provider and model. On a
narrow window the workload and provider columns open from switchers in the model list's header, and
the model details panel, with its settings, opens in place of the list.

Creating a connection writes its label, provider id, authentication type, key order, and enabled
state to SQLite. API keys and OAuth token fields are stored separately in the encrypted credential
vault. Connection responses contain only a masked key suffix and metadata.

Localix does not read provider API keys from environment variables such as `OPENAI_API_KEY`, either
when you connect a provider or when a request runs. A request authenticates only with the credential
stored for its connection. To rotate a key, add or replace it in Localix.

If you close the browser before finishing sign-in, return to the provider form and start sign-in
again. A new attempt cancels your pending login for that provider and waits for its local callback
listener to close before opening a fresh sign-in page.

A conversation stores a connection id and a namespaced model id **per participant**, and only when
someone actually chose one there. At run time, Localix verifies that the provider owns the model,
tries the stored connection first, and can resolve another usable connection for the same provider
if that one no longer works. It never crosses to a different provider or model.

### Which model a participant runs on

A new seat's route is decided once, when the participant joins, and then stored. Its model comes
from the first source that names one:

| Order | Source                                       | Set from                                                 |
| ----- | -------------------------------------------- | -------------------------------------------------------- |
| 1     | The conversation's choice **for this agent** | The model picker (including **All agents**), or `/model` |
| 2     | The agent's default                          | **the agent's Store page**                               |
| 3     | Your last choice **for this agent**          | Every pick for that agent, in any conversation           |
| 4     | The project                                  | **Settings → Project**                                   |

A new conversation is not seeded with a copy of another one: each agent resolves through this order.
An agent without a default model therefore starts on the model you last picked for it, including a
pick made through **All agents** or for an agent that was never invited. A participant never copies
another participant's model. With none of these sources, the seat has no model until you pick one.
The model picker lists an agent that is not invited yet on the model this order would give it.

Its **reasoning effort** is the explicit choice, otherwise the level of your last choice when the
model came from it, otherwise the level last chosen for that agent on that model, otherwise the
agent's default, otherwise **medium**. It never copies another participant's level or another
model's level, and it is never capped.

Later changes to defaults reach new seats only. Conversations created before this rule may hold a
seat with no model; it is filled once by the same rule on first read and stored. A delegated child
snapshots its assigned participant's route from the parent. Filled-in defaults never count as your
last choice for an agent.

A model that cannot reason receives no reasoning request. For models that support it, the runtime
clamps the requested effort to a supported level; that runtime adjustment does not rewrite the
conversation's stored preference. **Off** follows the same rule: on a model that cannot turn
reasoning off, it requests the model's lowest level rather than leaving the provider's default in
charge. On Claude models with per-turn effort, that default is **high**.

The model browser offers these optional workload settings:

| Workload          | Current runtime behavior                                                                                                                                                                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session titles    | Requires an enabled route with an assigned model; otherwise keeps the simple title and objective. Missing route effort uses **medium**, never the session effort.                                                                                                                 |
| Inline completion | Disabled by default. When enabled, tries the assigned model, then the session model if resolution fails. Always requests effort `off`, clamped to the model's minimum if necessary.                                                                                               |
| Session recap     | On by default; has its own switch on its model picker row. Uses the assigned model, otherwise the session model, with its own effort (default **medium**). Writes one line into the transcript when you come back to a chat; see [Conversation history](conversation-history.md). |

Each workload stores its own effort; picking a model for it starts at the level last chosen for that
workload and model, otherwise the default.

The board has no route of its own. A worker's model is its agent's — set on its Store page — so it
applies on every dispatch path rather than only on a card; a card that names no model inherits the
session that owns the board, like any other unrouted workload.

Within one connection, the runtime selects the enabled key with the lowest numeric priority.
Disabling the last enabled key and removing the only remaining key are separate guards. Removing an
enabled key while disabled keys remain can leave the connection with no runnable key; enable its
replacement before removing it. OAuth refresh runs through a connection-scoped credential store;
refresh updates for one key are serialized so concurrent runs do not overwrite rotating tokens.

Every model list shows the newest models first: the picker's per-connection lists, its search and
filter results, and the `/model` command's Model step. Release dates come from models.dev; models
without a date follow in catalog order.

### How the model list stays current

The model list is [models.dev](https://models.dev)'s, normalized for the providers Localix can
serve. Localix adds no metadata of its own: context windows, prices and their long-context tiers,
reasoning levels, and capabilities are models.dev's. A provider is listed when its models are served
through a provider package the engine carries (OpenAI, Anthropic, Google, OpenRouter, Vercel AI
Gateway, Amazon Bedrock, Azure, Google Vertex, and the OpenAI-compatible wire).

### Cloud connections

Amazon Bedrock, Azure and Google Vertex serve the same models through a cloud account, so a
connection names where in that account its requests go beside its key. The connection form asks for
exactly that:

| Provider         | Key                                              | Settings                                                     |
| ---------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| Amazon Bedrock   | A Bedrock API key                                | AWS region (required)                                        |
| Azure            | The resource's API key                           | Azure resource name (required)                               |
| Google Vertex    | A service account key (JSON) or a Vertex API key | Project (defaults to the key's own) and location (optional)  |
| Claude on Vertex | A service account key (JSON)                     | Project and location (optional; location defaults to global) |

Settings are stored with every key of the connection, so a key added later reaches the same place,
and they show in the connection's settings. A setting whose name reads like a secret (a key, token,
password, credential, or personal access token such as `CLARIFAI_PAT`) is refused, and a change that
includes one is rejected without writing anything; such a value stored by an earlier version is
never shown back. A name the provider's catalog entry does not ask for is refused too.

Requests use only what the connection holds. Every request names its address and passes its key
explicitly, so the server's own environment never supplies either: variables such as
`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, `AWS_ENDPOINT_URL`, other `AWS_*` values
or `GOOGLE_VERTEX_API_KEY` are not read, including ones exported in your login shell. A model whose
address needs a value no connection can set (a Vertex endpoint of its own) is not listed.

models.dev decides where most providers' requests go, so its addresses are checked before a key is
sent to one. OpenAI, Anthropic, Google, OpenRouter, GitHub Copilot and Vercel AI Gateway keys reach
only their own hosts, whatever the list says; a model's own address must stay on its provider's
origin (or inside its cloud); and every address is HTTPS, except one on this computer. A provider
whose address fails these checks is not listed, and neither is a model with such an address.

| When                                   | What happens                                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| First launch                           | The snapshot shipped with the app is used and stored, and the first check fetches the current list.               |
| Startup                                | The stored list is restored from `~/.localix/model-catalog/` before the first catalog answer. No request is sent. |
| Shortly after startup, then hourly     | One conditional request to models.dev; an unchanged list answers `304 Not Modified` and costs no download.        |
| **Settings → Models → Model list**     | **Check for new models** asks now, including when automatic checks are off.                                       |
| models.dev is unreachable or malformed | The current list stays; the server logs the cause. The setting row shows it after a manual check.                 |

The same list carries **decision models**, which answer typed questions instead of writing text
(models.dev's `decision` models on OpenRouter and Vercel AI Gateway, and OpenAI's Decisions API).
They appear only where a workload runs on them, never among chat models.

A model that leaves models.dev leaves the list at the next check. See
[Privacy](../getting-started/privacy.md) for exactly what is requested.

### Sign-in lifecycle

Browser and device-code sign-in finish in the API process. The interface looks for a new or changed
connection for the provider: up to 40 polls, with three seconds between attempts. Slow requests can
extend this beyond the roughly two-minute wait shown in the interface. Navigating away can stop
polling, and starting another sign-in stops the previous poll; this does not itself cancel the
server's login.

The server allows up to 15 minutes for a flow and 30 seconds for its first interactive event. If the
interface times out, check the connection list before retrying: server-side sign-in may still
finish. Pending flows are held in memory and do not survive an API restart. A retry replaces only
that user's pending flow for the same provider and waits for the adapter's cleanup.

Signing in again with the same provider and exact connection label adds an enabled key to the
existing connection. It does not replace older keys: the new key receives a higher numeric priority,
so an older enabled key remains first. If you intend to replace the old credential, enable the new
one and disable or remove the old one. Use a different connection label for a separate account.

Runtime login prompts have a limited adapter: a selection uses the first offered option, text
prompts receive an empty answer, and interactive secret prompts are rejected. Flows needing custom
answers to those prompts cannot be completed through the current provider form.

## Configuration

The `OpenAI` provider supports **Sign in with ChatGPT** for subscription authentication. New browser
authorizations identify the application as **Localix** on ChatGPT's connection screen. The browser
sign-in finishes in the background. Once the connection is saved, the desktop app comes to the
foreground and shows the model list for that connection, including after signing in again. Close the
success page manually. The browser login uses a stable installation UUID, created on first use and
retained in `~/.localix/oauth-device-id` across restarts and projects. `OpenAI Codex (legacy)`
remains a separate provider using the older ChatGPT backend transport; existing connections keep
their provider identity.

| Control or value     | Contract                                                                               |
| -------------------- | -------------------------------------------------------------------------------------- |
| Provider source      | Runtime catalog projected by the engine's `listCatalog()`                              |
| Catalog refresh      | `LOCALIX_MODEL_CATALOG_REFRESH=0` turns off the automatic checks; manual checks remain |
| API-key connection   | Requires at least one non-empty key                                                    |
| OAuth connection     | Uses the runtime-reported browser, loopback-server, or device-code interaction         |
| Connection label     | User-editable; does not change provider identity                                       |
| Key display          | Masked to the final four characters                                                    |
| Key selection        | Enabled keys ordered by ascending numeric priority                                     |
| Model identity       | Stored as `<providerId>/<modelId>`                                                     |
| Required route       | Chat sessions                                                                          |
| Context routes       | Session titles, inline completion, session recap                                       |
| Reasoning preference | Stored for the workload plus provider/model pair when supported                        |

There is no separate setup flow: the model picker under a chat composer creates API-key or OAuth
connections and selects the conversation's model.

## Limits

- “Provider-flexible” means the providers and models in the runtime catalog, not every provider,
  endpoint, protocol, or model.
- OAuth is not synthesized for API-key-only providers. The available sign-in methods are exactly
  those reported by the adapter's provider definitions: Sign in with ChatGPT (OpenAI), OpenAI Codex
  (legacy), OpenRouter, and GitHub Copilot.
- Sign-in for Anthropic (Claude Pro/Max), Kimi Coding, Meta, xAI and Radius is no longer offered.
  The Event Center lists each existing signed-in connection to one of them as "<name> needs an API
  key", from startup on, and its runs fail with "has no OAuth sign-in; reconnect it with an API
  key". Remove it and add the provider again with an API key; the entry settles once the connection
  is gone.
- Multiple keys do not provide automatic rotation or request failover. A run selects the
  highest-priority enabled key; a provider failure does not retry the next key.
- If vault data is missing, corrupt, or unreadable, Localix keeps the connection metadata visible
  but excludes the credential from runnable connection state.
- The same-provider connection fallback occurs during model resolution. A failed provider request
  does not switch connections, providers, or models silently.
- Model requests send the assembled prompt and context to the selected provider. Connected providers
  remain outside Localix's local trust boundary; see [Privacy](../getting-started/privacy.md).
- Advertised capabilities, modalities, limits, dates, and pricing are catalog metadata rather than a
  Localix guarantee about provider behavior or availability.
- A stored reasoning preference does not add reasoning support to a model that does not advertise
  it, and one provider can expose fewer effort levels than another. The catalog publishes the levels
  each model offers, so the picker shows only those; a preference carried over from a finer-grained
  model is clamped to the nearest level the new one has — upward first, then down. The runtime
  clamps again before the request, so a level from an older client or an unpublished capability
  degrades instead of failing the run.
- Release dates and reasoning levels come only from the runtime's catalog, shipped or refreshed. A
  model, date, or level a provider publishes later appears after the next successful check, not
  immediately. A source change that the shipped conversion rejects keeps the current list until an
  app update handles it.
- The catalog endpoint answers with an `ETag`. A client that already holds the current catalog gets
  `304 Not Modified` instead of the full list.
- Providers that offer no chat models, such as classifier-only ones, are not offered for connection.
- Ambient cloud credentials, such as AWS profiles or Google application-default credentials, are not
  used. Connect those providers through the provider form.
- When a chosen model cannot run, the error says why: the catalog no longer lists the model, the
  provider has no enabled key, or the connection's credential could not be loaded. The model picker
  shows `<model> is no longer available` when the catalog has dropped the model you chose.

## Related guides

- [Secrets](secrets.md)
- [Privacy](../getting-started/privacy.md)

## Source of truth

- [Catalog projection and refresh](https://github.com/rsaryev/localix/blob/main/packages/engine-models/src/catalog/catalog.ts)
- [models.dev normalization](https://github.com/rsaryev/localix/blob/main/packages/engine-models/src/catalog/normalize.ts)
- [Catalog refresh schedule](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/catalog/refresh-schedule.ts)
- [Provider transports and request shaping](https://github.com/rsaryev/localix/blob/main/packages/engine-models/src/providers/connect.ts)
- [Newest-first catalog order](https://github.com/rsaryev/localix/blob/main/packages/agent/src/catalog/model-order.ts)
- [Unresolved model reasons](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/model-resolution-miss.ts)
- [Sign-in and credential refresh](https://github.com/rsaryev/localix/blob/main/packages/engine-models/src/auth/auth.ts)
- [Connection API and DTOs](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/provider-connections/contracts.ts)
- [Credential storage and refresh](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/provider-connections/service.ts)
- [OAuth flow lifecycle](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/provider-connections/oauth-flow-manager.ts)
- [OAuth completion watch](https://github.com/rsaryev/localix/blob/main/apps/ui/src/entities/chat/ui/prompt-input/oauthConnectionWatch.ts)
- [Model and connection resolution](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/model-resolution.ts)
- [Participant model and effort precedence](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/agent-route-resolution.ts)
- [Participant birth and reseating](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/participant-routes.ts)
- [Recent model and effort selection](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/repository-recent-routes.ts)
- [Inline workload resolution](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/autocomplete/resolve-model.ts)
- [Title workload](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/service/title-generation.ts)
- [Key-selection policy](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/provider-keys.ts)
- [Model browser](https://github.com/rsaryev/localix/blob/main/apps/ui/src/entities/chat/ui/prompt-input/model-select/ModelBrowser.tsx)
- [Workload route catalog](https://github.com/rsaryev/localix/blob/main/apps/api/src/contracts/model-task-catalog.ts)
- [Group routing strategies](https://github.com/rsaryev/localix/blob/main/apps/api/src/features/chat/runtime/floor-advisor.ts)
- [Model route persistence](https://github.com/rsaryev/localix/blob/main/apps/ui/src/entities/chat/ui/prompt-input/model-select/useModelTaskRouting.ts)
- [Per-model reasoning control](https://github.com/rsaryev/localix/blob/main/apps/ui/src/entities/chat/ui/prompt-input/model-select/ModelDetailPanel.tsx)
