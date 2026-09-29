# Publishing runbook

## One-time setup (account owner)

1. Create an Apify account at https://console.apify.com/sign-up (use the email that will receive payouts).
2. Settings > Integrations > copy the **Personal API token**.
3. Settings > Payouts: add PayPal (minimum payout $20) or bank wire (minimum $100) and complete identity verification. Payouts are invoiced on the 11th and paid on the 21st to 25th of each month.
4. Optional: subscribe to the Creator Plan ($1/month for 6 months, $500 platform credit) at https://apify.com/pricing/creator-plan so free-tier runs of your actors do not cost you compute.

## Push actors

```bash
npm install
npx apify login -t <API_TOKEN>
npm run push                       # all actors
npm run push -- grants-gov-opportunities
```

## After the first push, in Apify Console for each actor

1. **Publication** tab: fill title, description, categories (Grants: "Business", "Other"; Podcasts: "Social media", "Other"; Permits: "Real estate", "Business"; Procurement: "Business"), add the README (pushed automatically), upload an icon, set the "Actor name" slug.
2. **Monetization** tab: choose **Pay per event**, add the events named in the table below with the listed prices, and save. Then set "Actor start" event to $0.00005 if offered.
3. Publish to Store.

| Actor | Event | Price |
|---|---|---|
| grants-gov-opportunities | `opportunity` | $0.010 |
| podcast-directory-scraper | `show` | $0.020 |
| podcast-directory-scraper | `episode` | $0.0005 |
| building-permits-open-data | `permit` | $0.006 |
| state-procurement-bids | `solicitation` | $0.015 |

Event names must match exactly; an unregistered event silently charges nothing.

## Maintenance loop

A scheduled Claude routine runs `npm run smoke` weekly, fixes broken selectors, re-runs the smoke test, and pushes the fix. Issues opened by users on the Store are answered within one business day, because response time feeds the Actor quality score that drives Store ranking.
