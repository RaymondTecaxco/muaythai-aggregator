# The Kru: NYC Muay Thai Event Aggregator & ETL Pipeline

## Why I Built This

As someone active in the NYC Muay Thai scene over the past few years, I kept running into the same problem: my training partners and I were tired of missing local fights and exhibition matches (aka smokers) because we had to search several different Instagram pages and websites just to find fight dates and bout opportunities. Promoters rely on everything from custom Wix sites to SimpleTix to unlinked digital flyers. I built this automated ETL pipeline to centralize that scattered data into one PostgreSQL database, powering a unified weekly event feed for the community.

## Architecture: The Modular Registry Pattern
Web scrapers break constantly when promoters update their websites. To ensure my pipeline doesn't crash entirely when a single site changes, I utilized a registry pattern. The core ingestion engine (index.js) is completely decoupled from the individual promotion scrapers.
- If a promotion/organization updates their DOM and breaks my CSS selectors, that isolated module fails gracefully and logs an error, while the rest of the pipeline continues fetching and syncing data.
- Scaling the app requires zero changes to the core logic. I simply drop new scraper modules into the /scrapers directory.

## Data Cleaning & Deduplication
The same fight is often announced by several accounts (the promotion, the host gym, gyms whose fighters are on the card), each worded differently. Storing the AI's free-text answers directly produced near-duplicate rows like "January 23. TBD" vs "January 23, 2027". The pipeline now treats this as a data-quality problem:
1. **Structured extraction:** Gemini returns separate fields (event name, promoter, date, time, venue, city, state, ticket link) under an enforced JSON schema, instead of one sentence.
2. **Standardisation** (`utils/cleanEvents.js`): placeholders like "TBD" become missing values; capitalisation, cities, state codes, promoter names and times are mapped to one standard form; links to bare homepages are rejected. The display text is then built from one template, so the same facts always produce the same text.
3. **Record linkage** (`utils/dedupeEvents.js`): records with the same date **and** the same promoter, venue or event name are treated as one event. The most complete record wins, and its gaps are filled from the others.
4. **Matching against stored rows:** before writing, the run reads upcoming rows from Supabase and **updates** a matching row instead of inserting a near-duplicate. A data-quality report prints how many records were dropped, merged, inserted and updated.
5. **History is kept:** past events stay in the `events` table; the `upcoming_events` view (`sql/upcoming_events_view.sql`) shows only future ones.

The rules are covered by automated tests built on real messy values (`npm test`).

## Technical Hurdles & The Stack
*   **Node.js & Puppeteer (Stealth):** Standard HTTP requests failed against dynamic Wix sites and Next.js ticketing portals. I implemented headless Chrome browsers with puppeteer-extra-plugin-stealth to render the JavaScript and successfully bypass the ticketing platforms' anti-bot API filters.
*   **Supabase (PostgreSQL):** Cloud database utilizing unique table constraints to handle .upsert() deduplication, preventing duplicate rows when the scraper runs multiple times.
*   **JavaScript (Regex):** Promoters write dates differently (e.g., "Oct 3" vs "10/3"). I wrote custom date-parsing utilities using Regex to convert messy text strings into standardized JS Date objects, allowing the pipeline to automatically filter out previous bouts.
*   **GitHub Actions:** CI/CD cron workflows schedule the pipeline to execute autonomously every Monday morning, meaning the calendar stays up to date without any manual intervention.

## Future Roadmap
This aggregator is only Phase 1 of a broader community platform. Future iterations currently in my Agile backlog include:
- A secure "Smoker" matchmaker board for local head coaches.
- Expanding the scraper registry to include grassroots development leagues like the Muay Thai Development League (MDL).
- An "Ask a Kru" monthly tactical column featuring insights from local trainers.

## Local Setup
1. Clone the repository: `git clone https://github.com/YOUR_USERNAME/muaythai-aggregator.git`
2. Install dependencies: `npm install`
3. Create a `.env` file at the root with your credentials:
   ```
   SUPABASE_URL=your_url
   SUPABASE_ANON_KEY=your_key
   APIFY_API_TOKEN=your_token
   GEMINI_API_KEY=your_key
   ```
   Optional settings:
   ```
   GEMINI_MODEL=gemini-3.5-flash-lite   # which Gemini model reads the flyers
   GEMINI_FALLBACK_MODEL=gemini-3.8-flash  # used if the main model is overloaded, out of quota or retired (leave empty to disable)
   GEMINI_RPM=4                    # max Gemini requests per minute
   GEMINI_TIMEOUT_MS=30000         # give up on a single Gemini call after this long
   ```
4. Execute the pipeline (these commands work in any terminal, including VS Code's PowerShell):
   - `npm start` (or `node index.js`) runs the full pipeline and syncs the database.
   - `npm run dry-run` (or `node index.js --dry-run`) runs everything but skips the database write and prints the rows it would have saved.
   - `npm run newsletter` (or `node beehiiv-formatter.js`) prints upcoming events formatted for Beehiiv.
   - `npm test` checks the data-cleaning and deduplication rules.
   - Every run ends with a timing report showing where the time went.
   - Gemini's answers are cached in `.cache/gemini-results.json`, so posts that were already analysed are never sent to the AI again. Delete that file to force a full re-read.