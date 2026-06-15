# ADR 0014 — Write-only secret IPC: the renderer never reads API keys back

**Status:** Accepted
**Date:** 2026-06-15
**Item:** 0016 — Settings screen: provider selection, API keys, disclosure + provider wiring

---

## Context

Item 0016 adds a Settings screen where the user can enter API keys (Deepgram, Anthropic, custom OpenAI-compatible). The keys must be stored in Electron `safeStorage` (DPAPI on Windows) via the main process — ADR 0005 and principles #9/#10 already establish that secrets live only in main.

The question is: what IPC surface does the renderer need for key management?

The obvious symmetric design would be:

- `secret:set` — renderer sends the key value to main for storage
- `secret:get` — renderer retrieves the key value for display or re-use

This is what most credential UIs do: show a masked field with the stored value pre-filled.

---

## Decision

We expose **only two channels**, and deliberately omit `secret:get`:

| Channel      | Direction       | Payload                          | Returns            |
| ------------ | --------------- | -------------------------------- | ------------------ |
| `secret:set` | renderer → main | `{ key: string, value: string }` | `{ ok: true }`     |
| `secret:has` | renderer → main | `{ key: string }`                | `{ has: boolean }` |

`secret:set` accepts a key value exactly once — at the moment the user clicks "Save". Main encrypts it immediately via `safeStorage.encryptString` (DPAPI) and stores the encrypted bytes in `secrets.json`. The plaintext value is never logged, never cached, and never sent back.

`secret:has` lets the renderer check presence so it can render the "key already saved" state (hiding the missing-key notice, greying out the save button). It returns a boolean only.

**There is no `secret:get` channel.** The renderer cannot retrieve the stored key value in any form.

---

## Consequences

**Positive:**

- A compromised renderer (XSS, supply-chain, etc.) cannot exfiltrate stored API keys, even if the attacker can call `window.api.*`. The worst they can do is overwrite a key with `secret:set` or read presence with `secret:has`.
- The renderer's key-entry field clears immediately after `secret:set` resolves. The plaintext key never lives longer than one event loop tick in the renderer.
- The constraint is enforceable at the type level: `RendererApi` simply has no `secretGet` method.
- Aligns with `ElectronSecretStorage` / `safeStorage` design intent: DPAPI-encrypted values should not travel over untrusted channels.

**Negative / trade-offs:**

- The UI cannot pre-fill the key field with the stored value. The user cannot see what they previously entered (only a "key saved" indicator). This is a deliberate UX trade-off for security.
- If a key is wrong (bad Deepgram key, wrong Anthropic key), the user must re-enter and save to correct it. There is no "peek" option.
- Tests that verify key presence must use `secret:has`; they cannot read back the stored value to assert it. The main-side tests work directly with `MemorySecretStorage` instead.

**Graceful no-key path:**

- `tryBuildProviders` (a non-throwing variant of `buildProviders`) returns a discriminated result type `{ ok: true, providers } | { ok: false, error: string }`.
- `src/main/index.ts` calls `tryBuildProviders` at startup. On failure it falls back to `FakeASRProvider` (audio bridge stays alive) and logs a warning. The renderer detects missing keys via `secret:has` calls on mount and shows a banner prompting the user to Settings — no crash.

---

## Alternatives considered

**`secret:get` returning a masked string (e.g. `sk-ant-...XXXX`):** Rejected. A masked display value gives false assurance; the actual value can still be extracted by a compromised renderer by calling `secret:get` and parsing the prefix.

**`secret:get` returning an empty string for "key set":** Rejected. Functionally equivalent to `secret:has`; adds complexity without benefit.

**Storing keys in the renderer's Zustand store:** Rejected outright. This is forbidden by ADR 0005 and principles #9/#10. Keys in renderer memory are accessible to any injected script.
