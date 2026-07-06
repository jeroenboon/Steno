# Lokale extractie (LM Studio / Ollama / llama.cpp)

Steno kan beslissingen en actiepunten laten extraheren door een LLM die je zelf draait, in plaats van een cloud-provider. Draai je ook lokale ASR (`local-parakeet`), dan blijft alles op je apparaat: de egress-badge leest dan "audio lokaal · notulen lokaal". Dat is de enige configuratie waarin er niets van de meeting je machine verlaat.

De lokale provider praat met elke OpenAI-compatibele server via `/v1/chat/completions`. Drie runtimes hebben een kant-en-klare preset; alles wat OpenAI-compatibel is werkt via de optie **Aangepast**.

## Verwachtingen

Lokale modellen zijn kleiner dan de grote cloud-modellen. Reken op minder scherpe extractie: gemiste actiepunten, ruwere samenvattingen, af en toe een eigenaar die niet klopt. Voor gevoelige meetings waar niets naar buiten mag is dat de afweging. Kies een instruction-tuned model dat JSON netjes teruggeeft (7B en groter werkt doorgaans redelijk).

## Status van de presets

- **LM Studio** is end-to-end getest tegen een echte server.
- **Ollama** en **llama.cpp** zijn voorbereid en op prefill- en wire-niveau getest, maar niet tegen een echte server geverifieerd. Werkt iets niet zoals verwacht, gebruik dan **Test verbinding** in de instellingen; die geeft een concrete hint.

## LM Studio

1. Installeer LM Studio en download een model (bijvoorbeeld een instruction-tuned 7B/8B).
2. Ga naar het tabblad **Developer** / **Local Server** en start de server. Standaardpoort is **1234**.
3. Laad het model dat je wilt gebruiken.
4. In Steno → Instellingen → Extractie: kies **Lokaal**, preset **LM Studio**. De base URL staat al op `http://localhost:1234/v1`. Vul bij **Model** de naam in zoals LM Studio die toont (LM Studio serveert het geladen model; de naam moet overeenkomen). Een sleutel is niet nodig.
5. Klik **Test verbinding** en sla op.

## Ollama

1. Installeer Ollama en haal een model op, bijvoorbeeld `ollama pull llama3.1`.
2. Ollama draait standaard op poort **11434** en serveert een OpenAI-compatibel endpoint op `/v1`.
3. In Steno → Instellingen → Extractie: kies **Lokaal**, preset **Ollama**. Base URL `http://localhost:11434/v1`, model bijvoorbeeld `llama3.1`. Geen sleutel nodig.
4. **Test verbinding**, dan opslaan.

## llama.cpp

1. Start de server van llama.cpp met een gguf-model, bijvoorbeeld `llama-server -m model.gguf --port 8080`.
2. Het OpenAI-compatibele endpoint staat dan op `http://localhost:8080/v1`.
3. In Steno → Instellingen → Extractie: kies **Lokaal**, preset **llama.cpp**. Base URL `http://localhost:8080/v1`. Bij **Model** kun je `local-model` laten staan; llama.cpp serveert het model dat je met `-m` hebt geladen.
4. Start je llama.cpp met `--api-key`, vul die sleutel dan in bij Steno. Anders laat je het sleutelveld leeg.
5. **Test verbinding**, dan opslaan.

## Een server op een andere machine

Wijs je de base URL naar een host die geen `localhost` is (bijvoorbeeld een Ollama op een NAS of homelab-box), dan verlaat de transcripttekst dit apparaat en gaat over je netwerk. Steno is daar eerlijk over: de egress-badge leest dan "notulen op eigen server (&lt;host&gt;)" in plaats van "notulen lokaal". Het blijft binnen je eigen netwerk, maar het is niet meer strikt op-apparaat.

## Sleutels

LM Studio en Ollama vragen geen sleutel; laat het veld leeg. llama.cpp met `--api-key` en servers achter een reverse proxy wel; vul die dan in. Steno stuurt de sleutel alleen mee in de request-headers en slaat 'm versleuteld op, net als bij de cloud-providers.
