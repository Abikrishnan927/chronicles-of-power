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

`data/history-events.json` is the canonical imported catalog. It currently contains **10,000 unique imported records**; the full browser catalogue contains **10,007 unique records** after adding the seven authored campaigns. With the local Node backend, `catalog-loader.js` fetches the imported data from `/api/history/events` in bounded pages of up to 1,000 records. On static hosting, it loads the same bundled JSON file and slices the records into equivalent 1,000-record pages in the browser. Both modes validate unique IDs before building the shared Campaigns and History Archive catalogue. If a page fails in backend mode, successful pages stay cached and Retry requests only missing pages. Both views search/filter the complete indexed dataset and automatically append records as you scroll, while keeping at most 108 cards in the DOM. The generated report is `data/history-report.json`; the catalog combines Wikipedia's 2024 annual events page with structured Wikidata results.

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
- `account-ui.js` and `backend/`: Django session login, profiles, dashboard, versioned saves, and verified progress APIs.
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

Open `http://localhost:3000/support/`. In local development, SQL.js initializes a private SQLite file and seeds the FAQ articles. With `DATABASE_URL`, the same store uses PostgreSQL and initializes `faqs` and `tickets` tables idempotently. Production mode refuses to start without `DATABASE_URL`; SQLite files are for local development only. `npm run init:support` initializes whichever store the environment selects.

Run all unit and integration tests with `npm.cmd test`. The original game continues to use its existing API routes; support routes are under `/api/support/`.

### AI provider

The assistant calls an AI provider from the backend and supplies matching FAQ rows plus relevant error-code guidance as context. It labels uncertain answers and offers a ticket form rather than asserting unsupported facts. The default is local Ollama (`AI_PROVIDER=ollama`, `AI_BASE_URL=http://localhost:11434`, model `qwen2.5:3b`). The answer timeout defaults to 90 seconds (`AI_TIMEOUT_MS`). Install/start Ollama and make that model available to enable answers. The browser never receives an API key.

To use a compatible hosted chat-completions API, set `AI_PROVIDER=openai-compatible`, `AI_BASE_URL` to the provider's HTTPS API root (including its API version path when needed), `AI_MODEL`, and `AI_API_KEY` in the ignored `.env` file. Do not put a real key in HTML, JavaScript, or `.env.example`. The provider must support JSON response format. If no AI key is configured or the provider is down, the assistant answers directly from matched PostgreSQL FAQ rows and the documented error-code catalog; unsupported questions are offered a PostgreSQL-backed ticket.

### MongoDB conversation logs and feedback

MongoDB is optional and separate from the PostgreSQL FAQ and ticket store. Set `MONGODB_URI` in `.env` to an authorized MongoDB deployment to enable `support_conversations` and `support_feedback` collections. When MongoDB is absent or rejects a write, the assistant response remains available, the UI says logs were not saved, and feedback requests return an explicit error. No password, API key, authorization header, or ticket email is written into chat logs.

For data minimization, chat text and optional feedback comments are capped and should not include credentials or payment details. Set an operational retention period in the MongoDB deployment and delete old chat and feedback documents on a regular schedule; no user identity or email is required for chat. Tickets are in PostgreSQL when configured, with local SQLite used only in development.

### Health and public service status

- Machine-readable health: `http://localhost:3000/health` (also `/api/health`)
- Health page: `http://localhost:3000/support/health`
- Custom 404: `http://localhost:3000/this-page-does-not-exist` (HTTP 404)
- Controlled development-only 500: start with `NODE_ENV=development` and open `http://localhost:3000/support/test-500`. This route is not registered outside development.
- Development-only API error checks: `/api/support/test-error/400`, `/401`, `/403`, `/429`, `/500`, and `/503` return controlled JSON errors with real HTTP statuses. These simulate support API responses only; the support portal does not use the game's account sign-in or authorization flow.

API errors use an `error` object containing the HTTP code, title, safe message, request ID, retryability, and troubleshooting steps. Support pages render errors inline with an assistant action; clicking it sends only the code, safe message, current path, request ID, and troubleshooting steps. Game AI and catalogue errors link to the same assistant with this safe context. It never sends server logs, credentials, or tokens. The 404 and 500 pages include safe guidance and a request ID. Partial failures such as optional MongoDB logging are reported as warnings while preserving a successfully generated answer or created ticket.

For the development-only test route in **Command Prompt**, start the app with `set NODE_ENV=development&& npm start`. In PowerShell, use `$env:NODE_ENV='development'; npm start`.

The portal checks the backend, SQL store, MongoDB, AI provider, and GitHub Status. GitHub Status is an unrelated public third-party status API; its documented endpoint is `https://www.githubstatus.com/api/v2/status.json` ([API documentation](https://www.githubstatus.com/api)). The endpoint is publicly accessible without a key. The API documentation does not specify a separate data license; the portal displays only the current status description and links back to the provider rather than republishing incident history. Calls time out after `STATUS_API_TIMEOUT_MS` (default 2.5 seconds, maximum 10 seconds), are cached for one minute, and the public endpoint is rate-limited by this app to 30 requests per minute per client. If the live status cannot be fetched, the UI explicitly identifies a fallback notice and does not claim that GitHub is down. This integration describes GitHub's status only; it is not an uptime monitor for this application.

### Deployment, limitations, and next improvement

**Upgrade deployment: Not deployed or verified.** The existing static site remains at [chronicles-of-power on GitHub Pages](https://abikrishnan927.github.io/chronicles-of-power/); it does not have the new account or database services. `render.yaml` describes the Express API and Django account API, and the frontend build targets Vercel. Configure a managed PostgreSQL URL and exact HTTPS origins; do not rely on an ephemeral service filesystem for data. Render free web services sleep after 15 minutes without traffic and may take about a minute to wake. Render Free PostgreSQL expires after 30 days and has no backups, so use Supabase PostgreSQL for longer-lived data. See the deployment guide below before creating services.

#### GitHub Pages static deployment

The browser game and historical data can run as static files. GitHub Pages does not run Node or Django; use `npm run build` with `PUBLIC_API_BASE_URL` and `ACCOUNT_API_BASE_URL` set to create a Vercel-ready bundle. MapLibre tiles and place lookup still require internet access. FAQ/error references work offline; chat, tickets, MongoDB logs, live health, accounts, and cloud saves use their configured APIs.

The supplied GitHub Pages URL can continue to serve the static app. For the full-stack Vercel deployment, set the build-time variables `PUBLIC_API_BASE_URL` and `ACCOUNT_API_BASE_URL`; `vercel.json` builds the static files and serves the branded 404 while preserving HTTP 404. Keep secrets only in Render's environment settings.

The support portal has no user authentication or public ticket lookup; it deliberately avoids exposing ticket details. MongoDB, an AI provider, and the external status API require their respective services/network access and are reported unavailable when they cannot be reached. **Proposed future improvement:** add authenticated ticket status updates and a support-agent workflow.

## Django accounts and persistent game progress

The original Express service remains responsible for the static game, historical catalogue, local AI, and support APIs. A separate Django service is the single authority for account authentication, player profiles, saved campaigns, and progress. The browser never treats local storage as an account credential; local device saves remain available when the Django API is not configured. Player saves and progress are owned by the authenticated Django user.

The Django API uses Argon2 password hashing, Django sessions, password validators, CSRF checks, throttled registration/login/reset requests, migrations, and the password reset token flow. PostgreSQL is required in production; SQLite is development-only. Saves are versioned, size-checked, owner-scoped, and use revision checks to reject concurrent stale updates. The first-save achievement is awarded only after a save record is committed. Browsing a catalogue event records one idempotent event discovery for that account. The authored Emergency campaign completion is checked by replaying its canonical choice effects on the server before marking it complete; unsupported generic-scenario completion claims do not count as completed progress.

### Local development (Windows PowerShell)

Use Python 3.12 or newer and Node.js 18 or newer. PostgreSQL is optional for local development; SQLite is the default. These commands create a virtual environment, install the Django dependencies, migrate the local SQLite database, and start Django:

```powershell
cd "C:\Users\A D M I N\Documents\Make yourself a King"
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
if (-not (Test-Path backend\.env)) { Copy-Item backend\.env.example backend\.env }
.\.venv\Scripts\python.exe backend\manage.py migrate
.\.venv\Scripts\python.exe backend\manage.py runserver 127.0.0.1:8000
```

In another PowerShell terminal:

```powershell
cd "C:\Users\A D M I N\Documents\Make yourself a King"
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd install
npm.cmd run dev
```

The root `.env.example` sets `ACCOUNT_API_BASE_URL=http://127.0.0.1:8000`. The Express server injects this API address into the browser configuration; set the same value in the ignored root `.env` if it is not already present. Open `http://localhost:3000`. The game and support portal keep the existing local-play experience; signed-in saves, progress, and bookmarks use the account API. To send password-reset messages during development, Django prints them to the backend terminal; the UI uses an account-neutral response and does not claim delivery when no email transport is configured.

Run the backend and existing Node tests:

```powershell
.\.venv\Scripts\python.exe backend\manage.py test accounts
npm.cmd test
```

The Django account API is at `/api/auth/` (`csrf/`, `register/`, `login/`, `logout/`, `me/`, `password-reset/`, and `password-reset/confirm/`); the profile API is `/api/profile/`. Save and progress APIs are `/api/saves/`, `/api/progress/`, `/api/progress/campaigns/`, `/api/progress/achievements/`, `/api/progress/activity/`, `/api/progress/events/discover/`, and `/api/bookmarks/`. The Express API provides `/api/history/events` with `offset`, `limit`, and optional `q`; `/api/support/faqs`, `/api/support/errors`, `/api/support/chat`, `/api/support/tickets`, `/api/support/feedback`, `/api/support/status`, `/api/health`, and `/health`; plus the existing `/api/ai/*` game routes. The frontend sends authenticated account requests with cookies and CSRF tokens. If Django runs on a different origin, configure that exact frontend origin in both `FRONTEND_ORIGINS` and `CSRF_TRUSTED_ORIGINS`.

## Deployment: Vercel, Render, Supabase, and Atlas

This repository now has a static Vercel build (`npm run build`, output `dist/`, configured in `vercel.json`) and a Render Blueprint (`render.yaml`) for two API services: existing Express game/support API and Django accounts/progress API. Both backends share one PostgreSQL URL, but run their own schema initialization: Django migrations run at service start; Express creates its `faqs` and `tickets` tables idempotently and seeds the FAQ records. The Node `/health` checks its database; Django `/health` checks its database. Actual provisioning and deployment have not been done from this workspace.

### Create provider accounts and database instances

1. Create a Supabase project and copy its PostgreSQL connection string from the project Connect panel. Set that URL as `DATABASE_URL` in **both** Render services. Keep SSL enabled. Supabase Free currently includes 500 MB database storage and pauses projects after a week of low activity; the Free plan does not list the Pro plan's daily backups. Treat it as a demo database, export backups yourself, and upgrade or move to a provider with managed backups before relying on long-term user progress. [Supabase Free pricing](https://supabase.com/pricing), [project pausing](https://supabase.com/docs/guides/platform/free-project-pausing).
2. Optionally create a MongoDB Atlas Free cluster in a region available to your account. Copy its URI to `MONGODB_URI`. The current Free cluster limit is 0.5 GB storage and 100 operations/second; it can auto-pause after 30 days without connections. Chat/feedback writes will report unavailable when this is not configured, while the FAQ answer and ticket flow remain usable. [Atlas Free cluster limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/).
3. Connect the GitHub repository to Render and create a Blueprint from `render.yaml`. Set each `sync: false` value in the Render dashboard. The Render free web services sleep after 15 minutes idle and can take about a minute to wake. Their local filesystem is ephemeral. Do not store database files there. Render's own Free PostgreSQL expires after 30 days and has no backups, so this setup deliberately uses Supabase instead. [Render Free service limits](https://render.com/docs/free).

### Configure Render environment variables

For `chronicles-power-api` (Express), configure:

- `NODE_ENV=production`, `HOST=0.0.0.0` (the Blueprint sets these), `DATABASE_URL`, and `CORS_ALLOWED_ORIGINS` (the exact Vercel HTTPS origin, comma-separated if needed).
- `MONGODB_URI` (optional until Atlas is configured).
- `AI_PROVIDER=openai-compatible`, `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`, and `AI_TIMEOUT_MS`. The key is server-only. Without the key, or when the provider is down, the FAQ/error-code fallback answers from PostgreSQL and offers a ticket when its records do not cover the question.
- `STATUS_API_TIMEOUT_MS` (optional; default 2500 ms).

For `chronicles-power-accounts` (Django), configure:

- `DJANGO_DEBUG=false`, `DJANGO_SECRET_KEY` (Render generates one), `DJANGO_ALLOWED_HOSTS` (the Render account-service host), `DATABASE_URL` (same Supabase project), and `DATABASE_SSLMODE=require` if the provider's URL does not set TLS.
- `FRONTEND_ORIGINS` and `CSRF_TRUSTED_ORIGINS` as the exact Vercel HTTPS origin, `DJANGO_SECURE_COOKIES=true`, `DJANGO_SESSION_COOKIE_SAMESITE=None`, and `FRONTEND_BASE_URL` (host only, used in password-reset links).
- Real password reset delivery additionally needs `DJANGO_EMAIL_BACKEND`, `DJANGO_EMAIL_HOST`, `DJANGO_EMAIL_PORT`, `DJANGO_EMAIL_HOST_USER`, `DJANGO_EMAIL_HOST_PASSWORD`, and `DJANGO_EMAIL_USE_TLS`. Without SMTP, reset messages are only printed in development and production should not claim delivery.

Render creates the service URLs after deployment. Copy the Express URL and Django URL for the Vercel build environment variables below. If the frontend and account service use unrelated `vercel.app` and `onrender.com` sites, browser third-party-cookie policies can block sessions even with secure `SameSite=None` cookies. For reliable browser sessions, attach custom domains under the same registered domain (for example, `game.example.com` and `accounts.example.com`) and use HTTPS.

### Configure Vercel and deploy

1. Import the same GitHub repository into Vercel. Use the repository root, build command `npm run build`, and output directory `dist` (already declared in `vercel.json`).
2. Add Vercel build environment variables `PUBLIC_API_BASE_URL=https://<express-render-host>` and `ACCOUNT_API_BASE_URL=https://<django-render-host>`. These are public service origins, not secrets. The build rejects non-HTTPS and localhost URLs.
3. Add the exact Vercel origin to Render's `CORS_ALLOWED_ORIGINS`, `FRONTEND_ORIGINS`, and `CSRF_TRUSTED_ORIGINS`, then redeploy Render and Vercel.
4. Confirm the Vercel root loads, `/support/faqs` resolves, an unknown path returns the branded 404 with HTTP 404, and the two Render `/health` paths return healthy database status. Vercel custom platform 500 pages are limited to Enterprise plans; Express itself serves the branded 500 page for application errors. [Vercel routing](https://vercel.com/docs/routing/rewrites), [Vercel custom error page limits](https://vercel.com/docs/custom-error-pages).
5. Manually create an account, save a campaign, log out, and log back in. Confirm the dashboard restores the save and that a second account cannot see it. Verify Mongo logs only after Atlas is configured. No live credentials or hosted services are available to complete these steps here.

### Environment variable index

Frontend build: `PUBLIC_API_BASE_URL`, `ACCOUNT_API_BASE_URL`.

Express: `NODE_ENV`, `PORT` (provided by Render), `HOST`, `DATABASE_URL`, `CORS_ALLOWED_ORIGINS`, `SQLITE_DB_PATH` (local development only), `MONGODB_URI`, `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`, `AI_TIMEOUT_MS`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL`, and `STATUS_API_TIMEOUT_MS`.

Django: `DJANGO_SECRET_KEY`, `DJANGO_DEBUG`, `DJANGO_ALLOWED_HOSTS`, `DATABASE_URL`, `DATABASE_SSLMODE`, `FRONTEND_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, `DJANGO_SECURE_COOKIES`, `DJANGO_SESSION_COOKIE_SAMESITE`, `FRONTEND_BASE_URL`, `DJANGO_EMAIL_BACKEND`, `DJANGO_DEFAULT_FROM_EMAIL`, `DJANGO_EMAIL_HOST`, `DJANGO_EMAIL_PORT`, `DJANGO_EMAIL_HOST_USER`, `DJANGO_EMAIL_HOST_PASSWORD`, and `DJANGO_EMAIL_USE_TLS`.

### Restore, persistence, and remaining setup

The database tables persist independently of Render service restarts; the Render filesystem does not. Supabase Free can pause and has limited storage and backup provisions, and Atlas Free is limited storage. Make regular database exports and test restore procedures. For durable production retention, use paid database plans with automated backups or a managed PostgreSQL provider with documented retention. The current GitHub Pages live URL remains a static legacy deployment until Vercel is configured; do not treat it as having accounts or database persistence.

**Proposed future improvement:** add authenticated support-ticket lookup and a support-agent workflow.
