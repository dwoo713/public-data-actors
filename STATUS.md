# Status (2026-09-29)

## Where things stand
- Four actors built, smoke-tested against live sources, committed on `main`. All four are pushed to the Apify account `proper_heron` and built successfully (build 0.1.1 each), but none are on the Store yet.
  - building-permits-open-data: https://console.apify.com/actors/ydMfwVpSQSyggNgge
  - grants-gov-opportunities: https://console.apify.com/actors/OxxtsgwNPczpmxrCv
  - podcast-directory-scraper: https://console.apify.com/actors/T00ogoqbyUoq1UczJ
  - state-procurement-bids: https://console.apify.com/actors/MoauugGva8TKHBEIQ
- Local Apify CLI is logged in (token in the OS keyring). GitHub CLI is logged in as dwoo713; remote is github.com/dwoo713/public-data-actors.
- Weekly health-check routine exists in Claude Code on the web (Mondays 6:47 AM Central). It clones this repo, runs `npm run smoke`, fixes breakage, pushes to `main`, and pushes to Apify only if `APIFY_TOKEN` is set in the cloud environment.

## Blockers only the account owner can clear (Apify Console)
1. Settings > Account: fill first/last name, set the username (auto-generated `proper_heron` is what the Store will show), and turn on "Make profile publicly visible". Publishing is refused until the profile is public.
2. Billing: add billing details and a payment method. The Monetization panel on every actor is disabled until this is done.
3. Optional: Settings > Payouts (PayPal or bank wire) so earnings can actually be paid out.

## Next steps after those, in order
1. Per actor: Publishing tab > Monetization > Pay per event > add the events and prices from `PUBLISH.md` > save. Display information and input schema already show green checks.
2. Publish to Store, per actor.
3. Set `APIFY_TOKEN` in the Claude Code web routine's environment so the weekly job can push fixes.
4. Optional: Creator Plan so free-tier runs do not cost compute.
5. Watch the Issues tab on each actor and answer within a business day; response time feeds Store ranking.

## Decisions already made
- Non-industry only. Public government and directory data. No login walls, no captcha evasion, no personal data.
- Pricing per record: grants $0.01, podcast show $0.02 / episode $0.0005, permit $0.006, solicitation $0.015.
- Apify caps actor descriptions at 300 characters; keep `.actor/actor.json` descriptions under that or `apify push` rejects them.
- Dropped sources and why: BidNet Direct (core fields behind registration); Texas ESBD, Maryland eMMA, Pennsylvania eMarketplace, Virginia eVA (robots.txt disallow all); Cal eProcure, Florida VBS, Arizona APP (need a browser session). Georgia GPR is implemented but skips itself while its robots.txt returns 503.

## Wave two candidates (after first sales)
- USPTO trademark search and status (needs the buyer's free USPTO API key as input).
- Contractor license verification across more states.
- More permit portals and procurement portals as they are verified public.
