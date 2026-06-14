# Dual-stream audio capture (microphone + system loopback)

To be useful for remote meetings (Teams/Zoom/Meet), the app captures two audio streams and mixes them into one source feeding the ASR Provider: the **microphone** (the local user) and **system audio loopback** (everyone else, who comes out of the speakers). On Windows this uses WASAPI loopback via Electron's `getDisplayMedia`. In-person mic-only is just the degenerate case with no loopback stream.

## Consequences

A microphone-only design would silently transcribe only the local user's half of any remote meeting, producing useless notes. That failure is invisible until someone tries it on a real call, so the dual-stream requirement is recorded here to stop a future "simplification" back to mic-only. Loopback capture carries a permissions and setup cost that mic-only would not.
