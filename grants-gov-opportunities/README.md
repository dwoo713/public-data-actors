# Grants.gov Funding Opportunity Scraper

Search and extract every federal grant opportunity on **Grants.gov** as clean, structured JSON. One run gives you the full synopsis, eligibility rules, award ceiling and floor, number of awards, deadlines, CFDA (assistance listing) numbers, agency contact, and direct download links for the NOFO attachments. No login, no API key, no captchas.

## What does Grants.gov Funding Opportunity Scraper do?

Grants.gov lists thousands of open, forecasted, closed, and archived federal funding opportunities from 26 grant-making agencies. The public site is built for browsing one opportunity at a time. This Actor turns it into a dataset you can filter, monitor, and load into your own tools.

For each opportunity it returns:

- Opportunity number, title, status (forecasted, posted, closed, archived), document type
- Agency code, agency name, top-level department
- Posted date, close date, archive date, last updated
- CFDA / assistance listing numbers and program titles
- Funding instruments (grant, cooperative agreement, other), funding categories, applicant types
- Full eligibility text
- Award ceiling, award floor, estimated total funding, number of awards, cost-sharing flag
- Plain-text synopsis (optionally raw HTML too)
- Agency contact name, email, and phone
- Every attachment with file name, size, MIME type, and a direct download URL
- Link back to the opportunity page on Grants.gov

## Why extract Grants.gov data?

- **Grant writers and consultants**: pull every opportunity in your niche each morning and stop refreshing the site.
- **Universities and research offices**: feed opportunities into an internal funding database or Slack channel.
- **Nonprofits and local governments**: filter by eligibility code so you only see what you can apply for.
- **SaaS and data products**: build grant-matching, alerting, or analytics on top of clean JSON instead of HTML.
- **AI agents**: call this Actor through the Apify MCP server and let an agent answer "what federal grants close this month for rural broadband?"

## Input

| Field | Type | Description |
|---|---|---|
| `keyword` | string | Free text, same as the search box on Grants.gov. Leave empty to list everything that matches the other filters. |
| `oppStatuses` | array | Any of `forecasted`, `posted`, `closed`, `archived`. Default `["posted"]`. |
| `agencies` | array | Agency codes such as `HHS`, `USDA-NIFA`, `DOC-EDA`, `DOE`, `NSF`. |
| `fundingCategories` | array | Category codes such as `AG`, `ED`, `EN`, `HL`, `ST`, `CD`, `IS`. |
| `eligibilities` | array | Eligibility codes such as `00` (state governments), `01` (county), `02` (city/township), `06` (public higher ed), `12` (501(c)(3) nonprofits), `23` (small businesses). |
| `fundingInstruments` | array | `G` grant, `CA` cooperative agreement, `PC` procurement contract, `O` other. |
| `cfda` | string | Assistance listing number, e.g. `11.029`. |
| `postedAfter` | date | Skip opportunities posted before this ISO date. |
| `closesAfter` | date | Skip opportunities that closed before this ISO date. |
| `maxResults` | integer | Stop after this many opportunities (default 100). |
| `includeDetails` | boolean | Fetch the full synopsis for each opportunity (default true). |
| `includeDescriptionHtml` | boolean | Also include the raw HTML synopsis. |

Example input:

```json
{
  "keyword": "broadband",
  "oppStatuses": ["posted", "forecasted"],
  "eligibilities": ["01", "02"],
  "closesAfter": "2026-10-01",
  "maxResults": 200
}
```

## Output example

```json
{
  "opportunityId": "363958",
  "opportunityNumber": "NOAA-NOS-NCCOS-2026-32934",
  "title": "Advancing coastal flood protection through public-private partnerships, innovative insurance products, and improved sediment management.",
  "agencyCode": "DOC-DOCNOAAERA",
  "agencyName": "DOC NOAA - ERA Production",
  "status": "posted",
  "docType": "synopsis",
  "postedDate": "2026-09-25",
  "closeDate": "2027-02-12",
  "cfdaNumbers": [
    "11.478"
  ],
  "url": "https://www.grants.gov/search-results-detail/363958",
  "scrapedAt": "2026-09-29T15:30:40.701Z",
  "topAgencyName": "Department of Commerce",
  "topAgencyCode": "DOC",
  "category": "Discretionary",
  "archiveDate": "2027-03-14",
  "lastUpdated": "Sep 25, 2026 11:52:47 AM EDT",
  "programTitles": [
    "Center for Sponsored Coastal Ocean Research Coastal Ocean Program"
  ],
  "fundingInstruments": [
    "Cooperative Agreement"
  ],
  "fundingCategories": [
    "Environment",
    "Natural Resources",
    "Science and Technology and other Research and Development"
  ],
  "applicantTypes": [
    "Others (see text field entitled \"Additional Information on Eligibility\" for clarification)"
  ],
  "eligibilityDescription": "Eligible applicants for Federal financial assistance in this competition are U.S. institutions of higher\r\neducation, non-profits, state and local governments, tribal government entities, U.S. Territor ...",
  "awardCeiling": 2000000,
  "awardFloor": 500000,
  "estimatedTotalFunding": 2000000,
  "numberOfAwards": 1,
  "costSharingRequired": null,
  "description": "The purpose of this document is to advise the public that NOAA/NOS/National Centers for Coastal Ocean Science (NCCOS)/Competitive Research Program (CRP) [formerly Center for Sponsored Coastal Ocean Research (CSCOR)/Coastal Ocean Program (COP)], is soliciting proposals for projects that will support  ...",
  "contact": {
    "name": "Nicola R Bell Grantor",
    "email": "Trevor.Meckley@noaa.gov",
    "phone": "301-628-1328",
    "description": "Technical Program Information: Trevor Meckley, Program Manager, Trevor.Meckley@n"
  },
  "attachments": [
    {
      "id": 355097,
      "fileName": "NOAA-NOS-NCCOS-2026-32934.pdf",
      "description": "Full Announcement",
      "mimeType": "application/pdf",
      "sizeBytes": 166608,
      "folder": "Full Announcement",
      "downloadUrl": "https://www.grants.gov/grantsws/rest/opportunity/att/download/355097"
    }
  ],
  "hasApplicationPackage": true
}
```

## How much does it cost?

This Actor uses **pay-per-event** pricing: you pay a small fixed amount per opportunity returned, and nothing else. There is no subscription and no charge for runs that return zero results.

- **$0.01 per opportunity** (with or without full details)

A typical daily monitor that returns 150 open opportunities in your field costs about $1.50. A one-time pull of every currently posted opportunity (roughly 900 to 1,500 records) costs $9 to $15.

## Legal and fair use

Grants.gov is a US federal government website and the opportunity data is public information. This Actor uses the same public search and detail endpoints the website itself uses, sends a small number of requests per second, and does not bypass any access control. Agency contact details are official government points of contact published for the purpose of answering applicant questions.

## Integrations and API

- **Schedule** the Actor to run every morning and receive new opportunities by email, Slack, or webhook.
- **Export** the dataset as JSON, CSV, Excel, or XML from the Apify Console or API.
- **Apify API**: start a run and read results from any language. See the API tab.
- **MCP**: this Actor is callable as a tool from Claude, ChatGPT, Cursor, and any MCP client through the Apify MCP server.
- **Integrations**: Google Sheets, Airtable, Zapier, Make, n8n, LangChain, and more through Apify integrations.

## FAQ

**Does it include forecasted opportunities?** Yes, set `oppStatuses` to include `forecasted`.

**Can I download the NOFO PDFs?** Each opportunity includes an `attachments` array with a direct `downloadUrl` for every file.

**How do I only get opportunities I am eligible for?** Use the `eligibilities` filter with your applicant type code, and read the `eligibilityDescription` field, which often narrows eligibility further than the code.

**How fresh is the data?** Every run fetches live from Grants.gov. Nothing is cached.

**What if I need more than 10,000 results?** Split the run by agency or status, or contact the developer through the Issues tab.

**Something looks wrong.** Open an issue on the Actor's Issues tab. Reports are usually answered within a business day.
