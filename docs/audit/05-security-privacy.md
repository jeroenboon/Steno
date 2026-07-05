# Audit 05 — Security & privacy

## Verdict

The Electron security baseline and the secrets/egress design are genuinely strong — better than most production Electron apps. The audit found **one critical incident-class finding** (a committed API key in a public repo) and a small number of hardening gaps.

---

## S1 — CRITICAL: probable Deepgram API key committed at `deepgram.txt`

The repo root contains `deepgram.txt` holding a single bare 40-character lowercase-hex string — exactly the format of a Deepgram API key. It was added in commit `c2a8591` ("fix(providers): build ASR and extraction independently so Deepgram works alone"), i.e. it looks like a debugging scratch file that got swept into a commit. **The repo is public.**

Why the existing defences missed it: gitleaks' Deepgram rule keys on the keyword `deepgram` appearing near the secret _in the content_; a bare hex string in a file whose only context is its _filename_ slips past, and GitHub push protection has the same blind spot.

**Required actions, in order:**

1. **Revoke the key in the Deepgram console immediately** and check usage logs for unfamiliar activity. Treat it as compromised — the repo is public and the key has been in history since `c2a8591`.
2. `git rm deepgram.txt` and commit.
3. History rewrite is optional _after_ revocation (a dead key in history is noise, not risk), but if desired: `git filter-repo --invert-paths --path deepgram.txt` + force-push + invalidate forks/clones.
4. Add a `.gitleaks.toml` with a custom rule for bare 40-hex-char strings in non-lockfile text files (or at least an allowlist-with-teeth), so filename-only context doesn't evade the scan again.

## S2 — MEDIUM: no navigation / window-open guards in main

`src/main/index.ts` never registers `webContents.setWindowOpenHandler` or a `will-navigate` handler. The Electron security checklist recommends explicitly denying new-window creation and navigation away from the app's own content. Today the exposure is small (strict CSP, `sandbox: true`, no remote content, no `openExternal` anywhere), but this is defence-in-depth that costs ~10 lines:

```ts
mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
mainWindow.webContents.on('will-navigate', (e, url) => {
  if (!url.startsWith(devServerUrl ?? 'file:')) e.preventDefault()
})
```

Fits naturally next to `createWindow()` and is testable in the `window-options.ts` style.

## S3 — LOW: `audio:frame` / `import:frame` payloads are trusted, not validated

The one-way PCM channels type the payload as `Uint8Array` via a parameter annotation (`src/main/index.ts:393-400`) — a compile-time claim, not a runtime check. Every invoke channel goes through Zod in the IPC registry; these two don't. Per-frame Zod parsing would be wasteful (this is the documented ADR 0013 trade-off), but a cheap `frame instanceof Uint8Array` + max-length guard in `pushAudioFrame` would close the only unvalidated renderer→main path without measurable cost.

## S4 — LOW: devlog content mode has no in-file marker of sensitivity

`logs/steno-dev.jsonl` (dev-only, gitignored) can contain full LLM prompts/responses — i.e. meeting content — when `--debug`/`STENO_DEBUG=1` is set. The gating and the fresh-file-per-session design are right. Consider writing a first-line banner (`"contains-content": true`) so a stray copied log is self-describing, and note that `logs/` lives under `process.cwd()` — inside the repo checkout — where "gitignored" is the only fence. It has held so far; S1 shows how thin that fence is.

---

## What is genuinely good (keep it this way)

- **Electron baseline (ADR 0005):** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` locked into a _pure, tested factory_ (`window-options.ts`) with an explicit "never weaken" contract comment. CSP applied via response headers (not meta tag), dev/prod aware, strict in production (`script-src 'self'`, `connect-src 'self'`, `object-src 'none'`).
- **Permission posture:** explicit `setPermissionRequestHandler`/`setPermissionCheckHandler` granting only audio capture, denying everything else; display-media handler grants WASAPI loopback audio only (thumbnail 1×1, no pixels), denies cleanly on failure.
- **Secrets (ADR 0014):** write-only over IPC — `secret:set` / `secret:has` exist, `secret:get` deliberately does not. Keys are DPAPI-encrypted via `safeStorage` into `userData/secrets.json` and never appear in settings JSON, the meeting DB, or renderer memory. `EgressState` is constructed to be serialisable _without_ ever carrying a key.
- **Preload discipline:** `src/preload/index.ts` exposes exactly the `RendererApi` surface via `contextBridge`, holds no state, and every push subscription returns an unsubscribe function. Renderer push payloads are re-validated with Zod on arrival (`renderer/src/ipc/onValidated.ts`).
- **Startup ordering:** IPC handlers are registered _before_ the renderer loads, eliminating the invoke-before-handler race by construction.
- **Privacy/egress (ADR 0003):** `computeEgressState()` + always-visible `EgressIndicator` + point-of-choice disclosure copy; devlog defaults to metadata-only; local-first defaults (Fake/local ASR fallback when keys are missing rather than crash or silent cloud use).
- **Supply chain:** SHA-pinned actions, grouped Dependabot with gated auto-merge, `npm audit` clean at audit time, CodeQL scheduled, lockfile committed, secret scan in CI _and_ reproducible locally with fail-loud semantics.

## Residual recommendations

1. Do S1 today; it's the only finding with a clock on it.
2. Promote the CI `security` job and CodeQL to required checks (already planned per repo memory).
3. When packaging lands: code-signing + `electron-updater` signature verification become the new top security tasks (see Audit 06 T2/T3).
