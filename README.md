# Public Data Actors

A portfolio of pay-per-event Apify Actors that turn public business and government data into clean JSON.

| Actor | Source | Price |
|---|---|---|
| `grants-gov-opportunities` | Grants.gov public API | $0.01 / opportunity |
| `podcast-directory-scraper` | Apple podcast directory + public RSS | $0.02 / show, $0.0005 / episode |
| `building-permits-open-data` | 14 city and county Socrata open-data portals (Chicago, NYC, SF, LA, Seattle, Austin, Cincinnati, Mesa, Montgomery County MD, Baton Rouge, Marin County, Cambridge) plus any custom Socrata dataset | $0.006 / permit |
| `state-procurement-bids` | Public state procurement portals: Massachusetts COMMBUYS, New Jersey NJSTART, OregonBuys, Georgia GPR, Iowa Bid Opportunities, Louisiana LaPAC | $0.015 / solicitation |

Rules every Actor follows: public pages only, no login walls, no captcha evasion, robots.txt respected, no individual personal data, polite request rates.

## Local development

```bash
npm install                 # installs apify-cli
npm run smoke               # runs every actor against a tiny input and checks it returns records
npm run smoke -- grants-gov-opportunities
```

Each actor folder is self-contained (`.actor/`, `src/`, `package.json`, `README.md`, `smoke-input.json`) and can be pushed on its own.

## Publishing

See `PUBLISH.md`.
