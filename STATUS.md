# Status (2026-09-29)

## Where things stand
- Four actors built, smoke-tested against live sources, committed on `main`. All four are pushed to the Apify account `opendatalabs` (renamed from the auto-generated `proper_heron` on 2026-09-29), built as 0.1.2, monetized pay-per-event, and PUBLISHED on the Store as of 2026-09-29 (`isPublic=true` via `apify actors info`; Store pages return 200 at apify.com/opendatalabs/<name>).
  - building-permits-open-data: https://console.apify.com/actors/ydMfwVpSQSyggNgge
  - grants-gov-opportunities: https://console.apify.com/actors/OxxtsgwNPczpmxrCv
  - podcast-directory-scraper: https://console.apify.com/actors/T00ogoqbyUoq1UczJ
  - state-procurement-bids: https://console.apify.com/actors/MoauugGva8TKHBEIQ
- Local Apify CLI and GitHub CLI are logged in on the dev machine; remote is github.com/dwoo713/public-data-actors.
- Weekly health-check routine exists in Claude Code on the web (Mondays 6:47 AM Central). It clones this repo, runs `npm run smoke`, fixes breakage, pushes to `main`, and pushes to Apify only if `APIFY_TOKEN` is set in the cloud environment.

## Blockers only the account owner can clear (Apify Console)
1. DONE 2026-09-29: public profile (name, README bio, GitHub link, "publicly visible" on, contact email hidden) and username `opendatalabs`.
2. DONE 2026-09-29: billing set up in Apify Console.
3. DONE 2026-09-29: payout setup and verification complete.
4. DONE 2026-09-29: pay-per-event pricing set and verified via `apify actors info` on all four actors (grants `opportunity` $0.01, permits `permit` $0.006, procurement `solicitation` $0.015, podcasts `show` $0.02 + `episode` $0.0005, plus `apify-actor-start` $0.00005 on each). The synthetic `apify-default-dataset-item` event was removed on every actor because the code already charges explicitly per record.

## Outward-facing site (2026-09-29)
- Repo made PUBLIC (GitHub Pages requires it). Landing page at `site/index.html` deploys via `.github/workflows/pages.yml` on every push that touches `site/`. Live at https://dwoo713.github.io/public-data-actors/ . It reads the live catalog from api.apify.com/v2/store?username=opendatalabs in the browser, so newly published actors appear automatically.
- Domain opendatalabs.dev registered 2026-09-29 via the Vercel registrar (auto-renew on). DNS lives at Vercel (ns1/ns2.vercel-dns.com): A @ -> 185.199.108/109/110/111.153 and CNAME www -> dwoo713.github.io, added with the Vercel CLI (`vercel dns add`) after a device-code login, then `vercel logout`. The claude.ai Vercel connector cannot write DNS (401) or create projects (403). GitHub Pages custom domain is set to opendatalabs.dev; HTTPS certificate issued ~22 min after the domain validated; Enforce HTTPS is ON. Site live at https://opendatalabs.dev (www redirects to apex). Note: .dev is HSTS-preloaded, so browsers never load it over plain HTTP; a missing cert looks like the site is down.
- Vercel's claude.ai connector cannot create projects (403) or write DNS (401), so hosting stays on GitHub Pages and DNS edits go through the Vercel CLI (device login, then logout).
- Store icons uploaded for state-procurement-bids and podcast-directory-scraper via Console; PNGs kept at `<actor>/.actor/icon.png`.
- One-click updater: Desktop shortcut "Update All Actors" -> AI Applications/Work/public-data-actors/Update All Actors.bat (git pull, npm install, smoke, push to Apify; logs in the logs subfolder).
- The Claude Code cloud health-check routine now runs every 2 days at 6:47 AM Central (odd days of the month). It still needs APIFY_TOKEN in the Donavon Cloud environment to push fixes.

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
