# Error catalog

Every yt-dlp error is mapped by `errorMapper` into `{ code, title, hint, raw }`. UI: short banner + "show details" (raw) + "retry".

| code | Detection (stderr/exit) | Title | Hint |
|---|---|---|---|
| `NETWORK` | timeouts, `Unable to download`, DNS, HTTP 5xx | Network failure | Check your connection and try again. |
| `UNAVAILABLE` | `Video unavailable`, `Private video`, `removed`, `not available` | Video unavailable | The video may be private, removed or blocked in your region. |
| `LOGIN_REQUIRED` | `Sign in`, `age-restricted`, `members-only`, bot check | Login required | Enable browser cookies in the settings and make sure you are logged in. |
| `FFMPEG_MISSING` | `ffmpeg not found`, `ffprobe and ffmpeg not found` | ffmpeg not found | Install ffmpeg or set its path in the settings. |
| `FORBIDDEN` | `HTTP Error 401/403/410`, `Forbidden` (checked before `NETWORK`, because yt-dlp words it as "Unable to download webpage") | Access refused by the server | The link may have expired or may only work for the original session, network or browser. Try again from the page, enable browser cookies, or search for the stream again. |
| `FILENAME_TOO_LONG` | `File name too long`, `Errno 36` | Title too long | Reduce the maximum title length in the settings. |
| `OUTDATED` | `Unable to extract`, `Please update`, `Unsupported URL` | yt-dlp may be outdated | Use the update button to get the latest yt-dlp. |
| `BINARY_MISSING` | ENOENT on spawn | yt-dlp not found | Install yt-dlp or set its path in the settings. |
| `UNKNOWN` | everything else | Download failed | See the details below. |

Rules are checked in the order of the table above (first match wins).
New patterns: add a row here + a test in `test/main/services/errorMapper.test.ts`.

## Language model errors (subtitle translation)

Not yt-dlp errors: `llmProviders.ts` maps the answer of a provider into `{ code, raw, retryAfterSeconds? }` (the token is cut out of `raw`, which is at most 500 characters). The screen shows the text of `llm.error.<code>` after "The translation failed."

| code | Detection | Message |
|---|---|---|
| `INVALID_TOKEN` | HTTP 401/403, or a text like `api key not valid`, `invalid api key`, `invalid x-api-key`, `unauthorized` (checked first) | The provider did not accept the token. |
| `QUOTA_EXCEEDED` | HTTP 402, or 429 whose text talks about quota, billing, credit, balance or insufficient | The account has no credit or quota left. |
| `RATE_LIMITED` | any other HTTP 429 (`retry-after` is read when it is a number of seconds) | The provider is limiting the requests. The translation waits and asks again up to four times before giving up. |
| `MODEL_NOT_FOUND` | HTTP 404 | The provider does not know this model. |
| `TIMEOUT` | no answer in two minutes | The provider took too long to answer. |
| `NETWORK` | `fetch` failed (DNS, refused, invalid address) | The provider could not be reached. |
| `BAD_RESPONSE` | any other status, or an answer with no text, or a translation that keeps coming with the wrong number of lines | The provider answered in a way the app could not use. |
| `CANCELLED` | the user cancelled | The translation was cancelled (not shown as an error). |

Before asking, the translation can also stop for what the settings lack or the file has: `no-token`, `no-model`, `no-address` (a provider of one's own with no address), `no-source`, `unreadable`, `too-large`, `empty`, `missing` and `busy` (texts `anime.translate.error.*`). New patterns: add a row here + a test in `test/main/services/llmProviders.test.ts`.

## Creating a subtitle from the audio (speech to text)

The errors of the service are the ones of the language models above (`INVALID_TOKEN`, `QUOTA_EXCEEDED`, `RATE_LIMITED`, `MODEL_NOT_FOUND`, `TIMEOUT`, `NETWORK`, `BAD_RESPONSE`, `CANCELLED`), mapped by the same code (`failureOf`), with two differences: an answer that is not a WebVTT subtitle (the model does not support `response_format=vtt`) is `BAD_RESPONSE` ("The answer is not a WebVTT subtitle: …"), and the time to answer is five minutes. Gemini (`geminiSpeech.ts`) is mapped by the same code; an answer that is not a list of `{start, end, text}` lines with times (or that was blocked and has no text) is `BAD_RESPONSE` ("The answer is not a list of subtitle lines with times: …"), and a 400 that says the key is not valid is `INVALID_TOKEN`. The screen shows "The subtitle could not be created." and the text of `llm.error.<code>`.

Before or around asking, the job can stop with: `no-token`, `no-model`, `no-address` (of the speech to text), `no-translation-token`, `no-translation-model`, `no-translation-address` (of the language model, when the plan translates the text, checked before anything is sent), `missing` (the video is not on the disk), `no-audio` (ffmpeg shows no audio stream, or made no part), `extract-failed` (ffmpeg could not be run, exited with an error or its output could not be read), `no-speech` (no part had a cue), `unreadable` (the file could not be saved), `busy` and `cancelled` (texts `anime.generate.error.*`). New patterns: add a row here + a test in `test/main/services/speechProviders.test.ts` or `subtitleGeneration.test.ts`.
