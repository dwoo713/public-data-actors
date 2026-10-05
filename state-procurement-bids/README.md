# State Procurement Bids Scraper (RFP, IFB, RFQ)

Collect every **currently open public-sector solicitation** from public US state procurement portals and get it back as one clean, normalized JSON record per bid. The Actor reads the same public listing and detail pages a vendor sees without an account, applies one schema across portals (title, agency, agency type, RFP/IFB/RFQ/RFI, posted and close dates with time zone, NIGP/UNSPSC codes, buyer contact, attachment download links), and charges per solicitation returned. No login, no browser automation, robots.txt respected on every portal.

## What does State Procurement Bids Scraper do?

State and local governments publish RFPs, invitations for bid, and quote requests on dozens of unrelated portals, each with its own layout, date format and search form. This Actor turns the public parts of those portals into a single dataset you can filter, monitor, load into a CRM or feed to an AI agent.

For every solicitation it returns:

- `portal`, `state`, `solicitationId`, `solicitationNumber`, `title`
- `agency` and a derived `agencyType` (state agency, county, city, school district, university, other)
- `solicitationType` normalized to `RFP`, `IFB`, `RFQ`, `RFI` or `other`
- `status`, plain-text `description` (up to 5,000 characters)
- `postedDate`, `closeDate` (ISO 8601 with the portal's local UTC offset when a time is published), `closeTime`
- `categories`: NIGP or UNSPSC codes with labels when the portal publishes them
- `location`, `contactName`, `contactEmail`, `contactPhone` (the buyer's official procurement contact)
- `attachments`: `{ name, url }` for every solicitation document
- `sourceUrl` back to the public page and `scrapedAt`

## Supported portals

| State | Portal | Listing source | Fields available | Detail page fetched |
|---|---|---|---|---|
| Massachusetts | COMMBUYS (Periscope) | Public bid search, status "Sent" | number, title, agency, buyer, opening date, posted date, location, UNSPSC/NIGP codes, bulletin description, attachments, info-contact email/phone when published | Yes |
| New Jersey | NJSTART (Periscope) | Public bid search, status "Sent" | same as COMMBUYS (NIGP codes, attachments, buyer name) | Yes |
| Oregon | OregonBuys (Periscope) | Public bid search, status "Sent" | same as COMMBUYS, plus procurement method used for RFP/IFB typing | Yes |
| Georgia | Georgia Procurement Registry (GPR) | Public JSON search, status "Open", state and local governments | number, title, agency, government type, process type, posted/close datetime, description, buyer name/email/phone, NIGP codes, documents, agency site link | Yes |
| Iowa | State of Iowa Bid Opportunities | Public JSON search | number, title, agency, description, valid from/until, county, solicitation type, contact name/title/email/phone, documents and links | Yes |
| Louisiana | LaPAC (Office of State Procurement) | Bids by department, all open bids | number, title, issuing entity (state, university, community college, parish, city, school board), date issued, bid opening datetime, solicitation PDF and addenda, buyer contact | Yes (contact page) |

Each run re-checks `robots.txt` for every selected portal before sending any other request. A portal whose robots.txt disallows the listing or detail paths, or cannot be fetched (HTTP 5xx), is skipped with a warning in the log and in the `SUMMARY` key-value record. At the time of writing, `ssl.doas.state.ga.us/robots.txt` answers HTTP 503, so Georgia is skipped until that recovers; the GPR module itself is complete and tested.

Portals that were evaluated and left out: Texas ESBD, Maryland eMMA, Pennsylvania eMarketplace and Virginia eVA publish `Disallow: /` for all crawlers; California Cal eProcure (PeopleSoft), Florida VBS, Arizona APP, Colorado VSS, Washington WEBS and Alaska Public Notices need a browser or a login-style session to reach the core fields.

## Use cases

- **Government contractors and sales teams**: get every open RFP, IFB and RFQ in your states each morning with buyer contact and documents, without clicking through six portals.
- **Bid notification and consulting services**: build a multi-state feed on top of one schema instead of maintaining six scrapers.
- **Market intelligence**: track which agencies buy what (NIGP/UNSPSC codes), how long solicitations stay open and who the buyers are.
- **AI agents**: call the Actor through the Apify MCP server so an agent can answer "which school districts in Massachusetts have HVAC bids closing this month?" with live data.

## Input

| Field | Type | Description |
|---|---|---|
| `portals` | array | Portal keys to scrape: `ma-commbuys`, `nj-njstart`, `or-oregonbuys`, `ga-gpr`, `ia-bidopportunities`, `la-lapac`. Default: all. |
| `keyword` | string | Optional text filter. Sent to the portal's own search where one exists (description search on Periscope portals, title search on GPR, keyword search on Iowa) and applied to the title on LaPAC. |
| `postedAfter` | date | Optional ISO date. Skip solicitations with a known posted date before this day. |
| `closesAfter` | date | ISO date, defaults to today. Skip solicitations whose close date is before this day. |
| `maxResultsPerPortal` | integer | Stop each portal after this many solicitations (default 100, prefilled 25). A full pull of 200 per portal with descriptions takes 10 to 20 minutes. |
| `maxRunSeconds` | integer | Stop cleanly once this many seconds have passed and finish with what was collected (default 0 = no extra limit). The actor always stops about 20 seconds before the platform run timeout and splits the remaining time evenly across the selected portals, so a run finishes as SUCCEEDED with partial data instead of TIMED-OUT. |
| `includeDescription` | boolean | Fetch each detail page for description, attachments, contact and codes (default true). |

Example input:

```json
{
  "portals": ["ma-commbuys", "or-oregonbuys", "ia-bidopportunities"],
  "keyword": "roof",
  "closesAfter": "2026-10-01",
  "maxResultsPerPortal": 100,
  "includeDescription": true
}
```

## Output example

One record from the OregonBuys portal, exactly as produced by a test run:

```json
{
  "portal": "or-oregonbuys",
  "state": "OR",
  "solicitationId": "S-73000-00017723",
  "solicitationNumber": "S-73000-00017723",
  "title": "Horseshoe Bar Quary Chip Rock Production",
  "agency": "Department of Transportation",
  "agencyType": "state agency",
  "solicitationType": "IFB",
  "status": "open",
  "description": "Project includes providing 16,000 cubic yards of graded medium chip aggregate meeting specified grading requirements from either a commercial source or crushed from the ODOT provided material source and stockpiled at location identified in Exhibit A Specifications.\n\nMobilization\n\n3/8\" No 4 Chip Rock In Stockpile",
  "postedDate": "2026-09-08T08:39:42-07:00",
  "closeDate": "2026-09-29T10:30:00-07:00",
  "closeTime": "10:30",
  "categories": [
    { "system": "NIGP", "code": "912-00", "label": "CONSTRUCTION SERVICES, GENERAL, INCLUDING MAINTENANCE AND REPAIR SERVICES)" },
    { "system": "NIGP", "code": "968-26", "label": "Crushing, Screening, etc. All types New or Recycled Aggregate, Brick or Stone Products Including Road Materials" }
  ],
  "location": "4098 - Region 4 Manager",
  "contactName": "David Dethloff",
  "contactEmail": "william.d.dethloff@odot.oregon.gov",
  "contactPhone": "503-569-8793",
  "attachments": [
    { "name": "00017723 ITBgts.docx", "url": "https://oregonbuys.gov/bso/external/bidDetail.sda?downloadFileNbr=794900&docId=S-73000-00017723&docType=B&mode=download&external=true" },
    { "name": "00017723 Sample Contract.docx", "url": "https://oregonbuys.gov/bso/external/bidDetail.sda?downloadFileNbr=794881&docId=S-73000-00017723&docType=B&mode=download&external=true" },
    { "name": "00017723 Exhibit A Specifications.docx", "url": "https://oregonbuys.gov/bso/external/bidDetail.sda?downloadFileNbr=794906&docId=S-73000-00017723&docType=B&mode=download&external=true" }
  ],
  "sourceUrl": "https://oregonbuys.gov/bso/external/bidDetail.sda?docId=S-73000-00017723&external=true&parentUrl=close",
  "scrapedAt": "2026-09-29T16:06:06.101Z"
}
```

And one from Iowa, which publishes a full contact block in its listing:

```json
{
  "portal": "ia-bidopportunities",
  "state": "IA",
  "solicitationId": "fdacb075-b4ae-48c8-97a3-0eb4abdc252e",
  "solicitationNumber": "005-RFP-3086-2027",
  "title": "Employee Benefits Consultant Services",
  "agency": "Administrative Services, Dept",
  "agencyType": "state agency",
  "solicitationType": "RFP",
  "status": "open",
  "description": "The State of Iowa is seeking a qualified and experienced employee benefits consultant to provide strategic, actuarial, and operational support for the State's employee benefits programs.\nFull solicitation information can be found here:\nhttps://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=DASIowa",
  "postedDate": "2026-09-14T14:00:00-05:00",
  "closeDate": "2026-10-20T14:00:00-05:00",
  "closeTime": "14:00",
  "categories": [],
  "location": "Polk County, IA",
  "contactName": "Jocelyn Brincks",
  "contactEmail": "jocelyn.brincks@das.iowa.gov",
  "contactPhone": "(515) 499-3659",
  "attachments": [
    { "name": "IMPACS Link", "url": "https://bids.sciquest.com/apps/Router/PublicEvent?CustomerOrg=DASIowa" }
  ],
  "sourceUrl": "https://bidopportunities.iowa.gov/Home/BidInfo?bidId=fdacb075-b4ae-48c8-97a3-0eb4abdc252e",
  "scrapedAt": "2026-09-29T16:06:26.143Z"
}
```

## How much does it cost?

The Actor uses **pay-per-event** pricing: a fixed price per solicitation returned and nothing else. Runs that return zero results cost nothing.

- **$0.015 per solicitation**, with or without detail pages

500 solicitations cost about $7.50. A daily monitor limited to 50 new bids per portal across all six portals costs at most $4.50 per day, usually much less because only new and still-open bids are returned.

## Legal and fair use

Everything the Actor reads is a public government procurement notice, published so that any vendor can find and respond to it. The Actor:

- only requests pages that are visible without an account and never touches pages marked for registered users;
- fetches and honors each portal's `robots.txt` on every run and skips the portal if crawling is disallowed or the file is unavailable;
- sends at most two concurrent requests per portal with a 300 ms pause between requests, and retries with exponential backoff;
- identifies itself with a User-Agent that names the Actor;
- stores only the buyer's official procurement contact that the agency itself published for bidder questions, never personal data from any other source.

Portal terms and posting rules remain in force for how you use the data; check them before redistributing documents.

## Integrations and API

- **Schedule** the Actor to run every morning and send new solicitations to Slack, email, Google Sheets or a webhook.
- **Export** the dataset as JSON, CSV, Excel or XML from the Apify Console or API.
- **Apify API and SDKs**: start runs and read results from Node.js, Python or any HTTP client. See the API tab.
- **MCP**: use the Actor as a tool from Claude, ChatGPT, Cursor or any MCP client through the Apify MCP server.
- **Integrations**: Zapier, Make, n8n, Airtable, LangChain and more through Apify integrations.

## FAQ

**Why did a portal return fewer results than `maxResultsPerPortal`?** Either the portal had fewer open solicitations, or the run's time budget for that portal ran out. The `SUMMARY` record in the key-value store says which: a portal cut short by time carries `"truncated": "time budget"`. Raise the run timeout or `maxRunSeconds`, or select fewer portals per run, to get more.

**Why do results sorted by close date start with bids closing today?** `closesAfter` defaults to today and works at day granularity, so bids whose deadline is later today are included. Set `closesAfter` to tomorrow to exclude them.

**Why is `solicitationType` sometimes `other`?** The type is derived from the portal's own type field when it has one and from the title otherwise. Notices, statements of qualifications, sole-source notices and untyped bids stay `other`.

**A portal returned nothing.** Check the run log: the portal was either skipped because of robots.txt, returned an HTTP error, or currently has no open solicitations matching your keyword. The `SUMMARY` record in the key-value store lists the outcome per portal.

**Can you add my state?** Open an issue on the Actor's Issues tab with the portal URL. Portals that are fully public and server-rendered or backed by a public JSON endpoint can usually be added; portals that require a login or a full browser cannot.

**How fresh is the data?** Every run fetches live from the portals. Nothing is cached between runs.
