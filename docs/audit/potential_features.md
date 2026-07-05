# Potential features

Product ideas from the audit, ranked by how much they exploit what the codebase already has. Each notes the seam it would build on, so effort estimates stay honest.

## High leverage (the architecture is already waiting for these)

### 1. Cross-meeting action tracking

The schema is explicitly "cross-meeting ready" (`owner`, `due_date`, `status` are real columns, per ADR 0006) but no UI uses it. Build: a Home-screen "open actions" board across meetings, and — the killer version — when a Draft is created with a title matching a previous meeting (recurring standup, weekly), auto-surface that meeting's open actions as the first agenda item. This turns the app from a note-taker into a follow-up machine, which is where meeting tools actually earn their keep.
_Builds on:_ existing `actionRepo` columns, meeting history (`MeetingQueryService`), Draft flow.

### 2. Speaker diarization → owner assignment

Deepgram already supports `diarize=true`; sherpa-onnx has speaker segmentation models. Map diarized speakers to the Participant list (a one-time "who is speaker 2?" prompt during the live session), then feed speaker labels into extraction so owner hints stop depending on names being spoken aloud. The assignment module (`src/shared/assignment/`) already owns the "never invent a participant" rule; this gives it dramatically better input.
_Builds on:_ `TranscriptSpan` (add optional `speaker`), `RealtimeAsrWire` per-vendor parse, assignment module.

### 3. Local extraction provider (complete the privacy story)

ASR can run fully on-device, but extraction is cloud-only, so "audio stays on device" still means notes text leaves it. An `OllamaExtractionProvider` (or llama.cpp server) is nearly free architecturally: the OpenAI-compatible wire already exists (`OpenAiJsonWire` + custom endpoint, ADR 0012/0027) — Ollama speaks that protocol. Mostly a presets + egress-copy + docs task, plus honest expectations about small-model extraction quality (a "local = lower quality" disclosure mirrors the existing point-of-choice disclosure pattern).
_Builds on:_ `OpenAICompatibleExtractionProvider`, `extractionPresets.ts`, `computeEgressState()` (`local:` variant already conceptually exists).

### 4. Full-text search across meeting history

SQLite is right there; FTS5 over transcript spans + items is a forward-only migration and one query service method. "Where did we decide X?" across months of meetings is a feature users ask for within a week of accumulating history.
_Builds on:_ `transcriptSpanRepo`, `MeetingQueryService`, hand-rolled migration pattern.

### 5. Span-anchored audio replay

Items already link to their transcript spans. If the app (optionally, off by default for privacy) retains the session audio as a local file with span time offsets, the Review screen can play the 20 seconds behind any Decision — the single best trust/correction tool a note-taker can have. Requires an explicit retention setting and a visible indicator, consistent with ADR 0003.
_Builds on:_ span `startMs`/`endMs` timing already tracked, `AudioCaptureBridge`, userData storage.

## Medium leverage

### 6. Draft prefill from Outlook calendar

The paste-an-agenda flow (`context:inferFromText`, ADR 0029) already parses free text into agenda + participants. A "paste invite" is the same seam; a proper Graph-API calendar integration is the deluxe version (adds OAuth + egress disclosure). Start with paste — zero new egress.

### 7. Third item type: Open Questions / Parking Lot

Meetings produce three things, not two: decisions, actions, and unresolved questions. The extraction contract, item lifecycle (Proposed/Confirmed), keyboard flow, and DB pattern all generalise. The cost is prompt + schema + UI column; the value is that "we never closed that question" stops being a recurring meeting's ghost.
_Builds on:_ `ExtractionEngine` per-item coercion, `ItemLifecycleService` (its Decision/Action parallelism becomes three-way — do the generalisation refactor first).

### 8. Nudge expansion

`deriveNudges` exists; the obvious next rules: Decision without owner, Action without due date, agenda item with zero discussion after N minutes, meeting running past scheduled length. Cheap, on-brand (the app's job is making the note-taker better, not replacing them).

### 9. Minutes export templates

Markdown export exists. Stakeholders ask for "the minutes" in a house style: an HTML template (print-to-PDF) with agenda, per-item Discussion Summaries, decisions and action table. Templates as local files keeps it offline.
_Builds on:_ `meetingExporter.ts`, discussion summaries from the final pass.

### 10. Undo for note-taker actions

Confirm/dismiss/edit are keyboard-fast, which also makes mistakes fast. A 10-step undo stack in main (the single source of truth for items, ADR 0033) with `Ctrl+Z` wired through the existing item IPC — small, and removes the fear from the keyboard-first flow.

## Foundation / distribution (prerequisites for growth)

### 11. Packaging + auto-update

No electron-builder config exists yet (Audit 06 T3) and `electron-updater` is an unused dep. Installer + code signing + update channel is what turns this from a repo into a product colleagues can run. This also unlocks honest testing of "packaged build" assumptions (devlog no-op, CSP, native module unpacking).

### 12. Meeting-language flexibility (NL/EN code-switching)

Dutch meetings drift into English mid-sentence. Today language is a per-meeting setting. Whisper handles code-switching reasonably; cloud vendors vary. A "mixed" language mode that picks the right provider options (or just documents which provider handles it best) matches the user base's reality.

## Deliberately not recommended (for now)

- **Real-time shared/participant view** (LAN web server): breaks the single-process privacy story and adds a server surface to an app whose security posture is "no inbound anything".
- **Cloud sync / multi-device**: the local-first SQLite design is a feature; sync would demand an account system and a very different threat model.
- **Auto-send of items to Jira/Planner/Teams**: high integration cost, and premature before cross-meeting tracking (#1) proves the data model. Revisit after #1 ships.
