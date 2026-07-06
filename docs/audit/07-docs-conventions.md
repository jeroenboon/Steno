# Audit 07 — Documentation, conventions & i18n

## Verdict

Documentation is a first-class citizen here and it shows: a glossary the code actually follows, 25 ADRs that map to real decisions, and a CLAUDE.md that survived a line-by-line check against the source during this audit. Findings are small drift items.

## What's there

- **CONTEXT.md** (105 lines): the domain glossary — Meeting, Decision, Action, Owner, Proposed/Confirmed, interim/final span, Egress State. Identifiers in code match it exactly; the audit found no term drift.
- **docs/adr/** — 25 ADRs (0001–0035, numbered to match original build items, gaps intentional). Recent ADRs (0032–0035) document the architecture-review follow-up. ADRs state trade-offs and consequences, not just choices.
- **docs/reviews/2026-07-architecture-review.md** — the internal review whose findings were then worked off branch-by-branch (see Audit 02). Keeping the review _and_ the fixes traceable is a strong pattern.
- **docs/plans/** — three feature plans that landed; useful history.
- **README.md** — good onboarding: quick start, native-ABI explanation, links to CONTEXT/CLAUDE/ADRs.
- **CLAUDE.md** — engineering rules of engagement + architecture map. Verified accurate.

## Findings

### D1 — README feature list understates the provider matrix (LOW)

README says "bring-your-own cloud ASR (Deepgram)". The codebase now ships Deepgram, OpenAI (realtime + batch), Azure OpenAI (realtime + Whisper batch), and Mistral Voxtral (realtime + batch) ASR, plus Anthropic / OpenAI-compatible / Azure extraction. The point-of-choice disclosure obligation (ADR 0003) makes accurate public docs part of the privacy story — update the list.

### D2 — Stray non-doc files undermine the otherwise tight hygiene (covered in Audits 05/06)

`deepgram.txt` (critical, see S1) and `lint-output.txt` in the root. Mentioned here because the `.gitignore` is otherwise unusually thoughtful (it even anticipates `test-output.txt` and gitignores the preview harness with an explanatory comment).

### D3 — i18n is Dutch-only by design; the type system is ready for a second locale (INFO)

`src/renderer/src/i18n/index.ts`: a typed dot-path dictionary, no runtime i18n dependency, `TranslationKey` derived from the Dutch dictionary so a future English dictionary is compiler-forced to full parity. Clean design for V1. Note the meeting _transcription language_ selector (nl/en) already exists in the Draft screen — UI locale and ASR language are properly separate concepts.

### D4 — Minor Dutch copy issues (NIT)

E.g. `draft.start.disabled.reason`: "Voeg een titel in om te kunnen starten" — mixes "voeg … toe" and "vul … in". Worth a native-speaker sweep over the ~270 strings before any external release.

### D5 — ADR numbering gap will confuse newcomers exactly once (NIT)

0016–0025 don't exist as files though CLAUDE.md says "numbered 0001–0025 to match the original build items" while the directory runs to 0035. The convention is documented, but a one-line `docs/adr/README.md` explaining the numbering (and indexing the ADRs) would kill the confusion cheaply.

## Conventions in practice

- **Commit history**: Conventional Commits with scopes, imperative subjects, and body context; recent history (e.g. `fix(live): restart the ASR socket on resume after a long pause`) reads as a changelog. The one-change-one-commit rule appears genuinely followed.
- **Formatting**: Prettier (no semicolons, single quotes, 100 cols, LF) + `.editorconfig` + `.gitattributes`; `format:check` gates CI.
- **Comment culture**: file-header comments explain _why_ and cite ADRs/items; this is consistent across main-process code and scripts. Above-average signal density; keep it.
- **Tests colocated** (`*.test.ts(x)` next to source), fakes provided at the port, injectable clock — the conventions the docs promise are the ones the code uses.
