# Privacy is provider-dependent, with explicit egress disclosure

The app does not promise "nothing leaves the device", because that is false whenever a cloud provider is selected. Instead the invariant is **no surprise egress and no logging of content or secrets**, and the app is **explicit, in the UI, about what data leaves the machine and to whom**, at all times.

## What this means

- **Local Parakeet ASR:** audio never leaves the device.
- **Cloud ASR:** the audio stream leaves the device, to the configured ASR provider only.
- **Cloud extraction (the V1 default):** transcript text leaves the device, to the configured LLM provider only.
- **Always, regardless of providers:** data is sent only to providers the user explicitly configured and nowhere else; transcript content and API keys are never logged or persisted outside their intended store; the most-private viable option is the default where a choice exists.

## Explicit egress disclosure (a build requirement)

The app must make the current data-egress situation visible and unambiguous, not buried in settings:

- A persistent, always-visible **egress indicator** during Draft, Live, and Review (e.g. a badge: "audio local · notes via Anthropic", or "audio via Deepgram · notes via Anthropic").
- A **clear disclosure at the point of choice** when a user selects a cloud ASR or cloud extraction provider, stating what will be transmitted and to which vendor.
- Provider/endpoint names shown in plain language so the user knows the actual recipient (including for a custom OpenAI-compatible endpoint).

## Considered options

- **Blanket "fully local / nothing leaves the device" promise:** rejected. It is untrue with cloud providers and would erode trust the instant someone inspects network traffic.
- **Silent cloud usage:** rejected. Sending meeting audio or transcript text off-machine without a visible signal is exactly the surprise this app must avoid.

## Consequences

Every screen that can be active while data flows must carry the egress indicator, and provider-selection UI must carry disclosure copy. This is a recurring UI obligation, not a one-off, so it is recorded here to keep it from being dropped as screens are built (see backlog items 0012 and 0013+).
