# Status (2026-09-29)

## Where things stand
- Four actors built, smoke-tested against live sources, committed on `main`. None are on the Apify Store yet.
- Weekly health-check routine exists in Claude Code on the web (Mondays 6:47 AM Central). It clones this repo, runs `npm run smoke`, fixes breakage, pushes to `main`, and pushes to Apify only if `APIFY_TOKEN` is set in the cloud environment.

## Next steps, in order
1. `npm install && npm run smoke` to confirm everything still passes on this machine.
2. `npx apify login` (opens a browser, or `-t <token>`), then `npm run push` to create all four actors in the Apify account.
3. In Apify Console, per actor: Publication tab -> Monetization -> Pay per event -> add the events and prices from `PUBLISH.md` -> Publish to Store.
4. Optional: subscribe to the Creator Plan so free-tier runs do not cost compute.
5. Watch the Issues tab on each actor and answer within a business day; response time feeds Store ranking.

## Decisions already made
- Non-industry only. Public government and directory data. No login walls, no captcha evasion, no personal data.
- Pricing per record: grants $0.01, podcast show $0.02 / episode $0.0005, permit $0.006, solicitation $0.015.
- Dropped sources and why: BidNet Direct (core fields behind registration); Texas ESBD, Maryland eMMA, Pennsylvania eMarketplace, Virginia eVA (robots.txt disallow all); Cal eProcure, Florida VBS, Arizona APP (need a browser session). Georgia GPR is implemented but skips itself while its robots.txt returns 503.

## Wave two candidates (after first sales)
- USPTO trademark search and status (needs the buyer's free USPTO API key as input).
- Contractor license verification across more states.
- More permit portals and procurement portals as they are verified public.
