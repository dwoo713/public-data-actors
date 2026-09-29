# public-data-actors

Portfolio of pay-per-event Apify Actors. Each top-level folder with `.actor/actor.json` is one self-contained actor.

## Hard rules for every actor
- Public pages and public APIs only. Never scrape anything behind a login, paywall, or "registered members only" label.
- Check robots.txt before crawling an HTML site and honor Disallow. JSON open-data APIs (Socrata, Grants.gov, iTunes) are exempt.
- No captcha solving, no fingerprint evasion, no residential proxies to dodge blocks.
- No individual personal data: no owner or applicant names, personal phones, personal emails. Business names and official government buyer contacts are fine.
- Polite rates: at most 2 concurrent requests per host, 300 ms spacing on HTML sites, identifying User-Agent.
- Charge with `Actor.charge({ eventName, count })` once per record before `pushData`; stop only when `eventChargeLimitReached` is true. Event names must match the Monetization tab exactly (see PUBLISH.md).

## Commands
```bash
npm install                                  # apify-cli
npm run smoke                                # every actor, tiny live input, asserts non-empty records
npm run smoke -- <actor-name>
npm run push -- <actor-name>                 # apify push (needs `npx apify login -t $APIFY_TOKEN` first)
```
Each actor's `smoke-input.json` is the canonical minimal test. `__minRecords` sets the pass threshold.

## Maintenance procedure (weekly routine or on a user issue)
1. `npm run smoke`. If everything passes, stop.
2. For each failure, reproduce with `cd <actor> && node src/main.js` using the smoke input, read the source site's current HTML or API response, and fix the selector or field map. Keep the normalized output schema stable.
3. Re-run the smoke test for that actor, then the full suite.
4. Commit with a message naming the actor and the source change, push to `main`, and if `APIFY_TOKEN` is set, `npm run push -- <actor>`.
5. Never disable a portal or city to make the suite pass without recording why in the actor README's "Supported sources" table.

## Conventions
- ESM JavaScript, Node 22, `apify` SDK, cheerio for HTML, no browsers.
- Dates as ISO strings. `scrapedAt` on every record. Null, not empty string, for missing values.
- READMEs are Store listings: keep them factual, at least 400 words, with a real output example and the price. No invented user counts or testimonials.
