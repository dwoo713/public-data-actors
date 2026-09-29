# Status (2026-09-29)

## Where things stand
- Four actors built, smoke-tested against live sources, committed on `main`. All four are pushed to the Apify account `opendatalabs` (renamed from the auto-generated `proper_heron` on 2026-09-29), built as 0.1.2, monetized pay-per-event, and PUBLISHED on the Store as of 2026-09-29 (`isPublic=true` via `apify actors info`; Store pages return 200 at apify.com/opendatalabs/<name>).
  - building-permits-open-data: https://console.apify.com/actors/ydMfwVpSQSyggNgge
  - grants-gov-opportunities: https://console.apify.com/actors/OxxtsgwNPczpmxrCv
  - podcast-directory-scraper: https://console.apify.com/actors/T00ogoqbyUoq1UczJ
  - state-procurement-bids: https://console.apify.com/actors/MoauugGva8TKHBEIQ
- Local Apify CLI is logged in (token in the OS keyring). GitHub CLI is logged in as dwoo713; remote is github.com/dwoo713/public-data-actors.
- Weekly health-check routine exists in Claude Code on the web (Mondays 6:47 AM Central). It clones this repo, runs `npm run smoke`, fixes breakage, pushes to `main`, and pushes to Apify only if `APIFY_TOKEN` is set in the cloud environment.

## Blockers only the account owner can clear (Apify Console)
1. DONE 2026-09-29: public profile (name, README bio, GitHub link, "publicly visible" on, contact email hidden) and username `opendatalabs`.
2. DONE 2026-09-29: billing details and a Visa payment method are on file.
3. DONE 2026-09-29: payout beneficiary saved (PayPal), identity verified.
4. DONE 2026-09-29: pay-per-event pricing set and verified via `apify actors info` on all four actors (grants `opportunity` $0.01, permits `permit` $0.006, procurement `solicitation` $0.015, podcasts `show` $0.02 + `episode` $0.0005, plus `apify-actor-start` $0.00005 on each). The synthetic `apify-default-dataset-item` event was removed on every actor because the code already charges explicitly per record.

## Outward-facing site (2026-09-29)
- Repo made PUBLIC (GitHub Pages requires it). Landing page at `site/index.html` deploys via `.github/workflows/pages.yml` on every push that touches `site/`. Live at https://dwoo713.github.io/public-data-actors/ . It reads the live catalog from api.apify.com/v2/store?username=opendatalabs in the browser, so newly published actors appear automatically.
- Domain opendatalabs.dev ($9.99/yr via the Vercel registrar): order 01M3Q65C42PHABFKSJ2JTB4EJ2 FAILED with payment-failed; the Vercel team has no working card. Owner adds a card at https://vercel.com/dwoo713s-projects/~/settings/billing, then: re-run the purchase, add A records 185.199.108.153 / .109 / .110 / .111 and CNAME www -> dwoo713.github.io in Vercel DNS, set the Pages custom domain (gh api -X PUT repos/dwoo713/public-data-actors/pages -f cname=opendatalabs.dev), enforce HTTPS after the cert issues.
- Vercel's claude.ai connector cannot create projects (403), so hosting stays on GitHub Pages.
- One-click updater: Desktop shortcut "Update All Actors" -> AI Applications/Work/public-data-actors/Update All Actors.bat (git pull, npm install, smoke, push to Apify; logs in the logs subfolder).
- Cloud routine trig_01T5AwP622bskwTDQtGxxEou now runs every 2 days at 6:47 AM Central (odd days of the month). It still needs APIFY_TOKEN in the Donavon Cloud environment to push fixes.

## Next steps, in order
1. DONE 2026-09-29: published to Store, all four.
2. Set `APIFY_TOKEN` in the Claude Code web routine's environment so the weekly job can push fixes.
3. Optional: Creator Plan so free-tier runs do not cost compute.
4. Watch the Issues tab on each actor and answer within a business day; response time feeds Store ranking.
5. Store listings need an Actor output schema (`.actor/output_schema.json`, referenced by `"output"` in actor.json) or the Publishing tab blocks publishing. Added 2026-09-29 to all four.

## Decisions already made
- Non-industry only. Public government and directory data. No login walls, no captcha evasion, no personal data.
- Pricing per record: grants $0.01, podcast show $0.02 / episode $0.0005, permit $0.006, solicitation $0.015.
- Apify caps actor descriptions at 300 characters; keep `.actor/actor.json` descriptions under that or `apify push` rejects them.
- Dropped sources and why: BidNet Direct (core fields behind registration); Texas ESBD, Maryland eMMA, Pennsylvania eMarketplace, Virginia eVA (robots.txt disallow all); Cal eProcure, Florida VBS, Arizona APP (need a browser session). Georgia GPR is implemented but skips itself while its robots.txt returns 503.

## Wave two candidates (after first sales)
- USPTO trademark search and status (needs the buyer's free USPTO API key as input).
- Contractor license verification across more states.
- More permit portals and procurement portals as they are verified public.
