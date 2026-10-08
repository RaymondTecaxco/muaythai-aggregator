# The Kru: NYC Muay Thai Event Aggregator & ETL Pipeline

## Why I Built This

As someone active in the NYC Muay Thai scene over the past few years, I kept running into the same problem: my training partners and I were tired of missing local fights and exhibition matches (aka smokers) because we had to search several different Instagram pages and websites just to find fight dates and bout opportunities. Promoters rely on everything from custom Wix sites to SimpleTix to unlinked digital flyers. I built this automated ETL pipeline to centralize that scattered data into one PostgreSQL database, powering a unified weekly event feed for the community.

## Architecture: The Modular Registry Pattern
Web scrapers break constantly when promoters update their websites. To ensure my pipeline doesn't crash entirely when a single site changes, I utilized a registry pattern. The core ingestion engine (index.js) is completely decoupled from the individual promotion scrapers.
- If a promotion/organization updates their DOM and breaks my CSS selectors, that isolated module fails gracefully and logs an error, while the rest of the pipeline continues fetching and syncing data.
- Scaling the app requires zero changes to the core logic. I simply drop new scraper modules into the /scrapers directory.

## Technical Hurdles & The Stack
*   **Node.js & Puppeteer (Stealth):** Standard HTTP requests failed against dynamic Wix sites and Next.js ticketing portals. I implemented headless Chrome browsers with puppeteer-extra-plugin-stealth to render the JavaScript and successfully bypass the ticketing platforms' anti-bot API filters.
*   **Supabase (PostgreSQL):** Cloud database utilizing unique table constraints to handle .upsert() deduplication, preventing duplicate rows when the scraper runs multiple times.
*   **JavaScript (Regex):** Promoters write dates differently (e.g., "Oct 3" vs "10/3"). I wrote custom date-parsing utilities using Regex to convert messy text strings into standardized JS Date objects, allowing the pipeline to automatically filter out previous bouts.
*   **GitHub Actions:** CI/CD cron workflows schedule the pipeline to execute autonomously every Monday.

## Future Roadmap
This aggregator is only Phase 1 of a broader community platform. Future iterations currently in my Agile backlog include:
- A secure "Smoker" matchmaker board for local head coaches.
- Expanding the scraper registry to include grassroots development leagues like the Muay Thai Development League (MDL).
- An "Ask a Kru" monthly tactical column featuring insights from local trainers.

## Local Setup
1. Clone the repository: `git clone https://github.com/YOUR_USERNAME/muaythai-aggregator.git`
2. Install dependencies: `npm install`
3. Create a `.env` file at the root with your Supabase credentials:
   SUPABASE_URL=your_url
   SUPABASE_ANON_KEY=your_key
4. Execute the pipeline: 'node index.js'