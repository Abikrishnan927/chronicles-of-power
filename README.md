# Chronicles of Power

Chronicles of Power is a browser based historical strategy game with a MapLibre world atlas, a source linked event archive, a deterministic campaign engine, and optional local Ollama AI. Imported historical records remain unverified and read only; the game can launch them as explicitly hypothetical simulations without promoting their historical status.

## Run locally

Requires Node.js 18 or newer. The Express server hosts the existing static frontend and local AI routes. Open **Command Prompt** in the project folder (or run the following commands in CMD):

```bat
npm install
npm run dev
```

Open `http://localhost:3000`. Ollama is optional: the map and game remain playable if it is stopped. MapLibre, basemap tiles, fonts, and place lookup still need internet access.

## Local AI with Ollama (optional)

AI requests use your local Ollama server at `http://localhost:11434` and the already-downloaded `qwen2.5:3b` model. They do not use a cloud provider or API key. The backend calls Ollama from Node; browser code cannot select a model or URL.

1. Open **Command Prompt** and confirm Ollama and the model are available:

   ```bat
   ollama --version
   ollama list
   curl.exe http://localhost:11434/api/tags
   ```

   The model list and API response should include `qwen2.5:3b`. If Ollama is not running, start the Ollama app from the Windows Start menu. Do not run `ollama pull`; this model is already downloaded.

2. In a second **Command Prompt**, enter the project folder and start the site:

   ```bat
   cd /d "C:\Users\A D M I N\Documents\Make yourself a King"
   npm install
   npm run dev
   ```

   The server prints its address and configured model. Open **http://localhost:3000**. If you already have a `.env` file, make sure its `OLLAMA_MODEL` is `qwen2.5:3b` and `PORT` is `3000`. If there is no `.env`, these are the defaults; the example config is `.env.example`. Restart `npm run dev` after changing configuration. If port 3000 is occupied, close the other app using it or set a different `PORT` in `.env`.

3. In another Command Prompt, check that the backend can reach Ollama and that the configured model is installed:

   ```bat
   curl.exe -i http://localhost:3000/api/health
   ```

   A healthy response has `"ok":true`, `"model":"qwen2.5:3b"`, and `"modelAvailable":true`. For an API test, fetch the first event and copy its `id` from the response:

   ```bat
   curl.exe "http://localhost:3000/api/history/events?offset=0&limit=1"
   ```

   Replace `PASTE_EVENT_ID_HERE` with that ID in this advisor request:

   ```bat
   curl.exe -X POST http://localhost:3000/api/ai/advisor -H "Content-Type: application/json" -d "{\"eventId\":\"PASTE_EVENT_ID_HERE\",\"date\":\"1900\",\"role\":\"Example Republic\",\"state\":{\"stability\":50,\"trust\":50,\"liberties\":50,\"legitimacy\":50},\"question\":\"What does this event record say?\"}"
   ```

   For a real in-game answer, choose an event, open **The Archivist**, and send a question; the site automatically supplies the selected event, date, player role, and current game state. For strategic orders, use **ASK LOCAL AI FOR A PROPOSAL** in a campaign. Review the proposal and select **CONFIRM & APPLY THROUGH ENGINE** to apply it; it is not applied automatically. A stopped service or missing model is reported in the UI with retry guidance. The world map and game remain playable without Ollama. Do not expose Ollama's port 11434 to the internet.

The health indicator in **The Archivist** shows whether Ollama and the configured model are available. AI actions show a preview; **Confirm** sends the canonical action to `engine.js`, while **Cancel** leaves state untouched. The engine currently models stability, trust, liberties, and legitimacy only; it has no separate money, industrial output, trade stockpile, military-unit, or resource ledger. The AI therefore shows no implemented costs and cannot apply those unsupported mechanics. Diplomacy is fictional dialogue, conversation history is separated by campaign and counterpart, and generated alternate events stay separate from the verified historical event catalog.

## Historical event archive

`data/history-events.json` is the canonical imported catalog. It currently contains **10,000 unique imported records**; the full browser catalogue contains **10,007 unique records** after adding the seven authored campaigns. On startup, `catalog-loader.js` fetches the imported data from `/api/history/events` in bounded pages of up to 1,000 records, checks the total and unique IDs, then builds one shared catalogue for Campaigns and History Archive. If a page fails, successful pages stay cached in memory and Retry requests only missing pages. Both views search/filter the complete indexed dataset and automatically append records as you scroll, while keeping at most 108 cards in the DOM. The generated report is `data/history-report.json`; the catalog combines Wikipedia's 2024 annual events page with structured Wikidata results.

The importers read annual event pages on English Wikipedia and query structured Wikidata event records, retaining source URLs and retrieval timestamps. Date precision is preserved, so a year-only date remains year-only. Wikipedia text is available under CC BY-SA 4.0; Wikidata structured data is CC0 1.0. Records are attributed but **unverified**: machine extraction does not establish historical accuracy. The sample represents every century from the 11th through the 21st, but older periods use selected 10-year windows rather than every year. By century, the report counts 14, 37, 53, 57, 64, 82, 78, 172, 4,443, 3,393, and 1,607 events respectively (11th through 21st). Coverage is uneven: North America 3,557; Europe 2,189; South Asia 449; East Asia 217; Southeast Asia 59; Central Asia 20; Middle East 280; Africa 266; Oceania 167; Central America and Caribbean 285; South America 397; and global/unknown 2,018. The report flags 1,765 records without an evidenced country and 1,462 without a description. It retains 16,107 source URLs; 13,714 Wikidata result bindings and 174 Wikipedia event links were processed, with 2,095 duplicate candidates removed across batches. No imported record is marked scenario-ready or playable. The global batches completed without API errors. A later country-scoped South Asia query returned HTTP 429 and added no records; that rate-limit response is logged in the report. These are source coverage limits, not verified historical completeness.

Imported records are research entries by default. Each can launch the universal hypothetical scenario generator, while its historical record remains unverified and source-backed; generic simulation status does not count as editorial review or historical verification. Search supports title, year, country, person, description, and source URLs; country, region, category, era, date, and sort filters all run against the complete shared dataset. The visible match count reflects the active filters, not only currently rendered cards. Entries with coordinates can appear as map markers; records without coordinates can still launch without forcing a misleading map change.

### Import in resumable batches

No dependency install is needed. Wikimedia requests include a descriptive User-Agent, timeout, retries, and a default 1.1 second delay. The annual-page importer handles at most 10 year pages per invocation and checkpoints under `.history-import/`. The Wikidata importer handles up to 100 years per invocation by default; use `--batch-years 10` for smaller queries. It caches responses and resumes by year under `.wikidata-import/`. Its default range is 1026-2026 CE and its default catalog cap is 10,000.

```powershell
npm run import:history
```

Run it again to continue year-page discovery. To control a batch, pass options after `--`. The commands below work in Command Prompt and PowerShell (PowerShell users may need to type `npm.cmd` instead of `npm` if script execution is disabled):

```powershell
npm run import:history -- --start-year 1900 --end-year 2026 --batch-years 10 --max-records 10000
```

To query structured events across the configured historical range in manageable 10-year batches, run this command again after each batch. It resumes at the next year from its checkpoint. Continue until it reports completion or reaches the record cap:

```powershell
npm run import:wikidata -- --start-year 1026 --end-year 2026 --batch-years 10 --max-records 10000
```

To target an underrepresented area, add a supported region name. This filters by Wikidata country or continent evidence; use a separate cache folder for each independent regional run:

```powershell
npm run import:wikidata -- --region "South Asia" --start-year 1801 --end-year 2026 --batch-years 10 --max-records 15000 --cache-dir .wikidata-region-south-asia
```

This project has reached its current 10,000-record cap. To continue beyond it, raise the limit and keep using the same cache directory (the bundled workspace currently resumes this collection with `.wikidata-expand`):

```powershell
npm run import:wikidata -- --start-year 1026 --end-year 2026 --batch-years 10 --max-records 15000 --cache-dir .wikidata-expand
```

For a small, isolated test import, use a scratch cache and output files so it does not replace the live browser catalog:

```powershell
npm run import:history -- --start-year 2024 --end-year 2024 --batch-years 1 --max-records 200 --cache-dir .history-test-import --output data/history-test-events.json --js-output data/history-test-events.js --report-output data/history-test-report.json
```

After checking the report, remove the three `data/history-test-*` files and `.history-test-import` folder if desired. The full import can take many batches and hours; it is intentionally explicit and rate limited. It resumes from its checkpoint and stops at the configured maximum. To exceed the current cap, raise `--max-records` and continue using the same cache directory. Historical coverage remains incomplete even though each century has sample records.

Use `--resume` to explicitly resume a compatible checkpoint. Use `--reset` only when intentionally restarting at the requested start year. To refresh year pages edited recently and the latest three configured years:

```powershell
npm run update:history
```

To regenerate the quality report from the current database without making network requests:

```powershell
npm run report:history
```

If requests fail, wait and rerun the same import command; cached successful responses and the year checkpoint allow it to continue. Check `data/history-report.json` for year-level errors. Wikimedia access requires an internet connection; the importer does not run automatically when the game opens.

The import report counts unique rows, centuries, regions, categories, missing dates/descriptions, ambiguous countries, removed duplicates, retained source URLs, scenario-ready records, playable campaigns, and API errors. Import commands also accept `--cache-dir`, `--output`, `--js-output`, and `--report-output` for isolated runs. HTTP 429 means Wikimedia is rate limiting the request: stop, wait, then retry the same command and cache directory; do not rapidly repeat it.

### Review and promote an event

Use the manual JSON importer for records assembled and checked by an editor. It rejects invalid dates, coordinates, source links, and duplicate identities, and still marks imported records read only:

```powershell
node scripts/ingest-events.mjs path/to/reviewed-events.json
```

Then explicitly move a record through `reviewed`, `scenario-ready`, and `playable` with a reviewer name and notes. The latter two stages require a scenario JSON file containing `startingState` (`stability`, `legitimacy`, `economy`, and `military` values from 0 to 100), `objectives`, `roles`, `supportedActions`, and `assumptions`.

```powershell
node scripts/review-event.mjs event-id reviewed --reviewer "Reviewer Name" --notes "Source and date checked"
node scripts/review-event.mjs event-id scenario-ready --reviewer "Reviewer Name" --notes "Scenario reviewed" --scenario path/to/scenario.json
node scripts/review-event.mjs event-id playable --reviewer "Reviewer Name" --notes "Approved for play" --scenario path/to/scenario.json
```

Human-reviewed `playable` promotion still marks an event as an authored historical scenario. In addition, every imported archive entry can launch a clearly labeled **hypothetical fallback simulation** without changing its review status, source metadata, or historical confidence. The fallback generator uses an event theme when available, conservative neutral game scales, a derived or explicitly invented playable role, and deterministic actions validated by `engine.js`. These game scales and outcomes are not historical claims. Map and territorial state are never inferred or altered by the fallback.

Run the full imported-event scenario validation and write the coverage report with:

```powershell
npm run report:scenarios
npm run test:scenarios
```

The report is written to `data/scenario-coverage-report.json`. It tests every imported row for scenario creation, a valid role, valid initial state, an engine-supported state-changing action, six-turn progression, a completion outcome, and unchanged map coordinates.

## Map and visual sources

- MapLibre GL JS 6.14.0 loads from unpkg; its public OSM vector demo style supplies geographic coastlines, labels, terrain and borders without a frontend API key. Map attribution is shown by the map control.
- Photon by Komoot provides optional keyless place search and reverse lookup. Search results are not stored.
- Historical event points are shown only when supported coordinates exist. The optional route overlay is labelled illustrative.
- The Delhi campaign uses locally bundled generated illustration, clearly identified as generated rather than archival photography. The project does not claim provenance or archival rights for generated artwork.

## Verify

```powershell
npm test
npm run test:scenarios
node --check server.js
node --check ai-service.js
node --check ai-ui.js
node --check scripts/history-pipeline.mjs
node --check scripts/ingest-events.mjs
node --check scripts/review-event.mjs
node --check app.js
```

## Main files

- `index.html`, `styles.css`, and `app.js`: map-first interface, archive explorer, sourced details, and playable interactions.
- `engine.js` and `campaign-data.js`: existing simulation logic and authored campaign data.
- `universal-scenarios.js`: category-aware hypothetical fallbacks that preserve imported history records.
- `server.js` and `ai-service.js`: same-origin Express server, local-only Ollama client, API schemas and deterministic action validation.
- `ai-ui.js`: optional AI preview, advisor, isolated diplomacy chat, and pending alternate-event controls.
- `.env.example` and `package-lock.json`: local model defaults and reproducible Express dependency installation.
- `scripts/history-pipeline.mjs`: Wikimedia discovery, enrichment, cache, checkpoint, import/update, and report commands.
- `scripts/ingest-events.mjs` and `scripts/review-event.mjs`: validated manual ingestion and human review/promotion workflow.
- `data/history-events.json`, `historical-events.js`, `data/history-report.json`, `data/history-import-manifest.json`: imported catalog, browser data, quality report, and batch totals.
- `tests/simulation.test.js` and `tests/scenario-validation.test.js`: simulation/import contracts and exhaustive imported-event playability validation.
- `tests/ai-service.test.js` and `tests/ai-server.test.js`: mocked local-model response validation, Ollama-offline behavior, request limits, and HTTP route smoke tests.

## Support portal

The original game remains at `/`. The separate support portal is available at `/support/` and includes a home page, SQL-backed FAQ search, an error-code reference, a dependency health page, custom 404/500 pages, and a reusable assistant widget.

### Quick start and database setup

Requires Node.js 18 or newer. From **Command Prompt**:

```bat
cd /d "C:\Users\A D M I N\Documents\Make yourself a King"
npm.cmd install
copy .env.example .env
npm.cmd run init:support
npm.cmd start
```

Open `http://localhost:3000/support/`. The SQL.js-backed SQLite database initializes and seeds 12 FAQ articles automatically; `npm run init:support` is also available for explicit initialization. The database and support tickets are stored at `.private/support.sqlite` by default, outside the static site. Set `SQLITE_DB_PATH` to choose another private path. Tables are `faqs` (question, answer, category, creation/update timestamps) and `tickets` (unique ticket number, issue, description, category, optional email and conversation reference, status, timestamps). Queries use bound parameters.

Run all unit and integration tests with `npm.cmd test`. The original game continues to use its existing API routes; support routes are under `/api/support/`.

### AI provider

The assistant calls an AI provider from the backend and supplies matching FAQ rows plus relevant error-code guidance as context. It labels uncertain answers and offers a ticket form rather than asserting unsupported facts. The default is local Ollama (`AI_PROVIDER=ollama`, `AI_BASE_URL=http://localhost:11434`, model `qwen2.5:3b`). The answer timeout defaults to 90 seconds (`AI_TIMEOUT_MS`). Install/start Ollama and make that model available to enable answers. The browser never receives an API key.

To use a compatible hosted chat-completions API, set `AI_PROVIDER=openai-compatible`, `AI_BASE_URL` to the provider's HTTPS API root (including its API version path when needed), `AI_MODEL`, and `AI_API_KEY` in the ignored `.env` file. Do not put a real key in HTML, JavaScript, or `.env.example`. The provider must support JSON response format. AI answers are unavailable if the configured provider cannot be reached; FAQ browsing remains available.

### MongoDB conversation logs and feedback

MongoDB is optional and separate from the SQLite FAQ and ticket store. Set `MONGODB_URI` in `.env` to an authorized MongoDB deployment to enable `support_conversations` and `support_feedback` collections. When MongoDB is absent or rejects a write, chat answers still work if AI is available, the UI says logs were not saved, and feedback requests return an explicit error. No password, API key, authorization header, or ticket email is written into chat logs.

For data minimization, chat text and optional feedback comments are capped and should not include credentials or payment details. Set an operational retention period in the MongoDB deployment and delete old chat and feedback documents on a regular schedule; no user identity or email is required for chat. Tickets remain in the local SQLite file and should be retained only as long as needed for support.

### Health and public service status

- Machine-readable health: `http://localhost:3000/api/health`
- Health page: `http://localhost:3000/support/health`
- Custom 404: `http://localhost:3000/this-page-does-not-exist` (HTTP 404)
- Controlled development-only 500: start with `NODE_ENV=development` and open `http://localhost:3000/support/test-500`. This route is not registered outside development.
- Development-only API error checks: `/api/support/test-error/400`, `/401`, `/403`, `/429`, `/500`, and `/503` return controlled JSON errors with real HTTP statuses. These simulate responses only; this project has no sign-in or authorization workflow.

API errors use an `error` object containing the HTTP code, title, safe message, request ID, retryability, and troubleshooting steps. Support pages render errors inline with an assistant action; clicking it sends only the code, safe message, current path, request ID, and troubleshooting steps. Game AI and catalogue errors link to the same assistant with this safe context. It never sends server logs, credentials, or tokens. The 404 and 500 pages include safe guidance and a request ID. Partial failures such as optional MongoDB logging are reported as warnings while preserving a successfully generated answer or created ticket.

For the development-only test route in **Command Prompt**, start the app with `set NODE_ENV=development&& npm start`. In PowerShell, use `$env:NODE_ENV='development'; npm start`.

The portal checks the backend, SQLite, MongoDB, AI provider, and GitHub Status. GitHub Status is an unrelated public third-party status API; its documented endpoint is `https://www.githubstatus.com/api/v2/status.json` ([API documentation](https://www.githubstatus.com/api)). The endpoint is publicly accessible without a key. The API documentation does not specify a separate data license; the portal displays only the current status description and links back to the provider rather than republishing incident history. Calls time out after `STATUS_API_TIMEOUT_MS` (default 2.5 seconds, maximum 10 seconds), are cached for one minute, and the public endpoint is rate-limited by this app to 30 requests per minute per client. If the live status cannot be fetched, the UI explicitly identifies a fallback notice and does not claim that GitHub is down. This integration describes GitHub's status only; it is not an uptime monitor for this application.

### Deployment, limitations, and next improvement

**Live Demo: Not deployed yet.** The app has not been deployed or verified on a hosting provider. To deploy, use a Node.js host such as Render for the Express app, configure `HOST=0.0.0.0` and the other environment variables in the host's secret manager, attach persistent storage for `.private/support.sqlite`, and use a managed MongoDB deployment if chat logging is wanted. Configure an AI provider reachable from that host; a loopback Ollama URL only works when Ollama runs on the same host. Test the public health and 404 endpoints after deployment.

The support portal has no user authentication or public ticket lookup; it deliberately avoids exposing ticket details. MongoDB, an AI provider, and the external status API require their respective services/network access and are reported unavailable when they cannot be reached. **Proposed future improvement:** add authenticated ticket status updates and a support-agent workflow.
