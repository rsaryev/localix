# Semantic search

Semantic search finds conversations by what they mean, not only by the words in them. A query in one
language can find a chat written in another, and "the chat about slow external-agent history" finds
a conversation titled with different words. It works in the search palette, the search tab and for
the agent, which searches through the same service.

**Availability:** On by default, with EmbeddingGemma 2 (Google, Apache 2.0, about 300 MB). The model
downloads quietly in the background on first start, the way an operating system fetches its
on-device models; until it is here, search matches words alone. The model runs on this computer; no
text leaves it.

## What you can do

| Capability                   | Mechanism                                                                                            | Boundary                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Get it ready                 | Nothing to do: while it is on, a missing model downloads in the background, even after a removal     | Needs a platform with a llama.cpp build (macOS, Linux, Windows on x64/arm64) |
| Choose the model             | The workload's model list: installed local embedding models and connected providers' ones            | Other local models are downloaded in **Settings → Models → Local**           |
| Search by meaning            | Type a description in the search palette or the search tab                                           | Chats and messages are matched by meaning; other domains match words         |
| Let the agent find past work | The agent's `global_search` tool runs the same search                                                | It skips hits from the conversation it is in                                 |
| Watch the index build        | The status bar shows the download and the index; its menu pauses, resumes and rebuilds it            | The first build indexes all history; later changes index within seconds      |
| Rebuild the index            | **Rebuild index** re-embeds everything from scratch                                                  | Search answers from words alone while it runs                                |
| Turn it off                  | The workload's switch in the model picker, or **Turn off** in the status bar menu (**Indexing off**) | Search is then words only, and a background download pauses                  |
| Remove the model             | **Remove model** (while off) deletes the model and every vector                                      | Turning it on again downloads it again                                       |

## How it works

Each user and assistant message is cut into passages of about 1,600 characters and embedded, and
each conversation title is embedded on its own. The vectors live in the local database. Hidden rows
(wake prompts, interface notices) are never embedded. New, edited and deleted messages reach the
index through database triggers that only record changes while semantic search is on.

A query runs two ways at once:

- **Words:** full-text search over messages, with the last word matched as a prefix while you type
  and longer Cyrillic words matched by their stem.
- **Meaning:** the query is embedded and compared with every passage. Scores are put on one scale
  per query, and a passage counts only when it stands out from the rest of your history by a margin
  that grows with how much history there is. Short, generic messages that resemble everything are
  penalized, so they do not crowd out real matches.

A result qualifies by standing out in meaning or by containing at least half of the query's words.
Its score adds the two, so all the words of an exact lookup outrank a loose meaning match, and a
query made only of codes or numbers weighs words higher still. An unrelated query returns nothing
rather than the nearest noise.

When the model is unavailable — downloading, starting, or failed — search answers from words alone
and says so.

## Configuration

| Setting        | Value                            | Effect                                                        |
| -------------- | -------------------------------- | ------------------------------------------------------------- |
| Model          | EmbeddingGemma 2, Q8_0           | Pinned revision and checksum; never a floating "latest"       |
| Stored width   | 256 dimensions                   | Matryoshka truncation, re-normalized                          |
| Passage length | 1,600 characters, 24 per message | The rest of a very long message stays searchable by its words |
| Model memory   | Released after 10 idle minutes   | The next search loads it again (about a second)               |
| Files          | `~/.localix/models`              | Shared with [local models](local-models.md)                   |

## Limits

- Domains other than chats and messages (files, skills, plugins) are matched by words only.
- The model's knowledge sets what counts as related: it will not know that a product name you use
  privately means a particular feature.
- Index state belongs to this computer. Another device builds its own.

## Related guides

- [Local models](local-models.md)
- [Conversation history](conversation-history.md)
- [Connect model providers](providers.md)
