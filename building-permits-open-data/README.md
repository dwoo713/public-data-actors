# Building Permits Open Data Scraper

Pull building permit records from US city and county open-data portals that run on Socrata (the SODA API behind data.cityofchicago.org, data.cityofnewyork.us, data.sf.gov and hundreds of other government sites) and get them back in **one normalized JSON schema**: permit number, type, status, work description, site address, coordinates, applied/issued/completed dates, declared valuation, fees and the contractor's company name. No login, no API key, pay per permit.

## What does Building Permits Open Data Scraper do?

Every city publishes permits with different column names (`permit_`, `permitnum`, `work_permit`, `permit_nbr`...), different date formats and different ideas of what "cost" means. This Actor hides that. Pick the cities you care about, optionally narrow by issue date, permit type or minimum valuation, and receive a flat dataset you can drop into a spreadsheet, CRM or BI tool. Each record also keeps `sourceKey`, `sourceDomain`, `sourceDatasetId` and `sourceUrl`, so you always know which portal it came from, and `includeRaw` gives you the untouched original row when you need a field that is not in the common schema.

The Actor talks directly to each portal's JSON endpoint (`https://<domain>/resource/<id>.json`), pages through results 1,000 rows at a time ordered by issue date (newest first), retries on rate limits and server errors with exponential backoff, and processes cities one after another so it stays well within the portals' anonymous rate limits. Supplying a free Socrata `appToken` raises those limits.

## Supported cities

All datasets below were verified live against the SODA endpoint (field names taken from each dataset's `/api/views` metadata) and had permits issued within the last week at the time of writing.

| Key | City / county | Dataset | Typical fields available |
|-----|---------------|---------|--------------------------|
| `chicago` | Chicago, IL | data.cityofchicago.org `ydr8-5enu` | number, type, work type, status, description, address, lat/lon, applied + issued dates, reported cost, total fee, contractor company |
| `nyc` | New York City, NY (DOB NOW: Build - Approved Permits) | data.cityofnewyork.us `rbx6-tga4` | permit, work type, filing reason, status, description, address, borough, ZIP, lat/lon, approved/issued/expiration dates, estimated job cost, applicant business + license, BIN/BBL |
| `nyc_bis` | New York City, NY (legacy DOB BIS Permit Issuance) | data.cityofnewyork.us `ipu4-2q9a` | job/doc/sequence number, permit type + subtype, status, address, borough, ZIP, lat/lon, filing/issuance/expiration dates, permittee business + license |
| `sf` | San Francisco, CA | data.sf.gov `i98e-djp9` | number, permit type, status, description, address, ZIP, lat/lon, filed/approved/issued/completed dates, estimated + revised cost, proposed units and stories |
| `la` | Los Angeles, CA (permits issued 2020 to present) | data.lacity.org `pi9x-tg5x` | number, type, subtype, status, description, address, ZIP, lat/lon, submitted/issued/CofO dates, valuation, use description, square footage |
| `seattle` | Seattle, WA | data.seattle.gov `76t5-zqzr` | number, type, class, status, description, address, ZIP, lat/lon, applied/issued/expires/completed dates, est. project cost, contractor company, housing units, record link |
| `austin` | Austin, TX (Issued Construction Permits) | data.austintexas.gov `3syk-w9eu` | number, type, work class, status, description, address, ZIP, lat/lon, applied/issued/expires/completed dates, job valuation, contractor company + trade, floors/units, record link |
| `cincinnati` | Cincinnati, OH | data.cincinnati-oh.gov `uhjb-xac9` | number, type, work class, status, description, address, ZIP, lat/lon, applied/issued/expires/completed dates, est. cost, fee, company, units, record link |
| `mesa` | Mesa, AZ | citydata.mesaaz.gov `dzpk-hxfb` | number, type, type of work, status, description, address, lat/lon, opened/issued/finaled dates, total valuation, fees, contractor company + license, dwelling units |
| `montgomery_county_md_residential` | Montgomery County, MD (residential) | data.montgomerycountymd.gov `m88u-pqki` | number, application type, work type, use code, status, description, address, city, ZIP, lat/lon, added/issued/finaled dates, declared valuation, building area |
| `montgomery_county_md_commercial` | Montgomery County, MD (commercial) | data.montgomerycountymd.gov `i26v-w6bd` | same as residential |
| `baton_rouge` | East Baton Rouge Parish, LA | data.brla.gov `7fq7-8j7r` | number, type, designation, description, address, city, ZIP, lat/lon, creation/issued dates, project value, permit fee, contractor company, square footage |
| `marin_county` | Marin County, CA | data.marincounty.gov `mkbn-caye` | number, type, work class, category, description, address, city/town, ZIP, lat/lon, received/issued dates, construction value, contractor company + license |
| `cambridge` | Cambridge, MA (Addition/Alteration permits) | data.cambridgema.gov `qu2z-8suj` | id, type, building use, status, description, address, ZIP, lat/lon, submitted/issued dates, total cost, firm name, units, stories |

Not every portal publishes every field. San Francisco, Los Angeles and Montgomery County do not publish a contractor column at all, Chicago and Mesa have no site ZIP code, and Baton Rouge and Marin have no status field; those normalized fields are `null` for such sources. Any other Socrata portal can be added on the fly with the custom mode described below.

## Use cases

- **Contractor lead generation**: new residential and commercial permits are a signal that a property owner is spending money right now. Filter by `permitTypeContains` ("roof", "solar", "hvac", "plumbing", "demolition") and `minEstimatedCost` to build daily call lists by ZIP code.
- **Market research and construction analytics**: track permit volume and declared valuation by city, permit type and month; compare markets on the same schema without writing one parser per city.
- **Real-estate analytics**: enrich property records with renovation history, ADU conversions, unit changes and new construction, and spot neighborhoods where activity is accelerating.
- **Insurance and risk**: monitor structural, electrical, roofing and demolition work at insured addresses; verify that declared work was actually permitted.
- **Supplier and services sales**: building-material suppliers, dumpster rental, equipment leasing and cleaning companies use issued permits to reach general contractors as jobs start.

## Input

| Field | Type | Description |
|-------|------|-------------|
| `cities` | array | Registry keys from the table above. Default `["chicago", "nyc"]`. Processed sequentially. |
| `custom` | object | Optional extra Socrata dataset: `{ "domain", "datasetId", "fieldMap", "city", "state" }`. See Custom portals. |
| `issuedAfter` | string | ISO date `YYYY-MM-DD`. Only permits issued on or after this date. |
| `issuedBefore` | string | ISO date `YYYY-MM-DD`. Only permits issued before this date (exclusive). |
| `permitTypeContains` | string | Case-insensitive substring match on the permit type field (`upper(field) like '%X%'`). |
| `minEstimatedCost` | number | Skip permits with a declared valuation below this amount. Ignored for sources without a cost column. |
| `maxResultsPerCity` | integer | Stop each city after this many permits. Default 500, maximum 100,000. |
| `includeRaw` | boolean | Attach the untouched portal row under `raw`. Default false. |
| `appToken` | string (secret) | Optional Socrata application token sent as `X-App-Token`. |

Example input:

```json
{
  "cities": ["chicago", "nyc", "sf"],
  "issuedAfter": "2026-08-30",
  "permitTypeContains": "alteration",
  "minEstimatedCost": 500000,
  "maxResultsPerCity": 1000
}
```

## Output example

Real records from a test run on 2026-09-29 (`cities: ["chicago", "nyc", "sf"]`, `issuedAfter` 30 days back, 20 permits per city). Fields that a given portal does not publish are `null`; a few sources add extra source-specific fields such as `contractorType`, `approvedDate`, `bin`, `proposedUnits` or `recordUrl`.

```json
{
  "permitNumber": "B01358922-S2-GC-CX",
  "permitType": "General Construction",
  "permitSubtype": "Initial Permit",
  "status": "Permit Issued",
  "workDescription": "This subsequent filing SI MS/GC (Job B01358922-S1) to correct and update plan for legalization since amendment is not allowed under the initial I1 filing Job B01358922-I1.  No change in occupancy, use, bulk or egress under this application.",
  "address": "147 DIAMOND STREET",
  "city": "Brooklyn",
  "state": "NY",
  "zip": "11222",
  "latitude": 40.727487,
  "longitude": -73.947937,
  "appliedDate": null,
  "issuedDate": "2026-09-25",
  "completedDate": null,
  "expirationDate": "2026-10-27",
  "estimatedCost": 6050,
  "fees": null,
  "contractorName": "CLIFF REFRIGERATION & A/C",
  "contractorLicense": "614451",
  "unitsOrStories": null,
  "recordUrl": null,
  "approvedDate": "2026-09-03",
  "contractorLicenseType": "GC",
  "workOnFloor": "Cellar, Cellar, Floor Number(s) 002 through 002, Floor Number(s) 002 through 002, Open Space, Roof",
  "jobFilingNumber": "B01358922-S2",
  "bin": "3065795",
  "bbl": "3026240018",
  "sourceKey": "nyc",
  "sourceName": "New York City, NY (DOB NOW)",
  "sourceDomain": "data.cityofnewyork.us",
  "sourceDatasetId": "rbx6-tga4",
  "sourceUrl": "https://data.cityofnewyork.us/d/rbx6-tga4",
  "scrapedAt": "2026-09-29T15:50:09.855Z"
}
```

```json
{
  "permitNumber": "B200510330",
  "permitType": "PERMIT – EXPRESS PERMIT PROGRAM",
  "permitSubtype": "Electrical Work",
  "status": "ACTIVE",
  "workDescription": "LOW VOLTAGE/COMMUNICATION ELECTRICAL WORK. INSTALL SECURITY. SPECIFIC LOCATION: LOWER LEVEL.",
  "address": "50 W WASHINGTON ST",
  "city": "Chicago",
  "state": "IL",
  "zip": null,
  "latitude": 41.88332219914999,
  "longitude": -87.62977509664286,
  "appliedDate": "2026-09-03",
  "issuedDate": "2026-09-28",
  "completedDate": null,
  "expirationDate": null,
  "estimatedCost": 19000,
  "fees": 100,
  "contractorName": "CECO, INC.",
  "contractorLicense": null,
  "unitsOrStories": null,
  "recordUrl": null,
  "contractorType": "ELECTRICAL CONTRACTOR",
  "sourceKey": "chicago",
  "sourceName": "Chicago, IL",
  "sourceDomain": "data.cityofchicago.org",
  "sourceDatasetId": "ydr8-5enu",
  "sourceUrl": "https://data.cityofchicago.org/d/ydr8-5enu",
  "scrapedAt": "2026-09-29T15:50:09.425Z"
}
```

All dates are ISO `YYYY-MM-DD`; `estimatedCost` and `fees` are numbers in USD; `latitude`/`longitude` are WGS84 decimals.

## How much does it cost?

The Actor uses pay-per-event pricing: **$0.006 per permit** pushed to the dataset (event `permit`). There is no charge for pages that return nothing or for records skipped by your filters. 1,000 permits cost about $6, and 10,000 permits about $60. Use `maxResultsPerCity`, date and cost filters to cap spend, or set a maximum charge on the run; the Actor stops cleanly when the charge limit is reached.

## Data privacy

All records come from public government open-data portals published under each city's open-data terms. The Actor is deliberately conservative about people:

- Only **business / contractor company names** are mapped to `contractorName`. Columns that hold an individual's name (property owner, applicant, permittee first/last name, licensed individual, filing representative, architect of record) are never mapped. Where a portal column mixes companies with sole proprietors (Chicago contacts, Marin, Mesa, Baton Rouge), a business-name heuristic keeps values like "ADICORP ELECTRIC INC" and drops values like "CRUZ, MARIO G".
- Owner names, owner addresses, owner phone numbers and personal emails are never included in the normalized output.
- In custom mode, pass-through columns whose names look personal (owner, applicant, permittee, contact, first/last name, phone, email, and similar) are dropped, and name-like columns are filtered with the same business heuristic.
- `includeRaw: true` attaches the original row exactly as the portal publishes it, which may contain fields the normalized output omits. Turn it on only when you need it and handle the data responsibly.

## Custom portals

Any Socrata dataset works, not just the built-in ones. Find the dataset id in the portal URL (the `xxxx-xxxx` part, e.g. `https://data.example.gov/d/abcd-1234`) and map the columns you care about:

```json
{
  "cities": [],
  "custom": {
    "domain": "data.honolulu.gov",
    "datasetId": "4vab-c87q",
    "city": "Honolulu",
    "state": "HI",
    "fieldMap": {
      "permitNumber": "buildingpermitno",
      "permitType": "buildingpermittype",
      "status": "statusdescription",
      "address": "address",
      "issuedDate": "issuedate",
      "completedDate": "completeddate",
      "estimatedCost": "estimatedvalueofwork",
      "fees": "bpfeescollected",
      "contractorName": "contractor"
    }
  },
  "maxResultsPerCity": 100
}
```

`fieldMap` keys are the normalized output names; values are the dataset's column names. `issuedDate` is used for the `$where` date filters and `$order`; `permitType` and `estimatedCost` enable the type and cost filters. Columns you do not map are passed through under their original names (minus personal-looking ones). If the dataset stores dates as `MM/DD/YYYY` text, add `"dateKind": "textMDY"`; if the cost column is text, add `"costIsText": true`. Point coordinates in a `location` column are picked up automatically.

## Integrations and API

Run it on a schedule, connect it to Google Sheets, Slack, Zapier, Make or a webhook through Apify integrations, or call it from your own code with the Apify API and client libraries for JavaScript and Python. Results are available as JSON, CSV, Excel or XML from the dataset endpoint, and you can filter the dataset view to just the columns you need.

## FAQ

**Why is `contractorName` empty for San Francisco or Los Angeles?**  Those portals do not publish a contractor column in their permit dataset. The field is `null` rather than guessed.

**Why do some Chicago permits have no contractor?**  Chicago lists up to fifteen contacts per permit; when none of them is a contractor company (for example owner-as-general-contractor jobs, or a sole proprietor listed by personal name), the field is left empty by design.

**Why does the legacy NYC dataset (`nyc_bis`) behave differently?**  DOB BIS stores issuance dates as `MM/DD/YYYY` text, so the Actor restricts the query by month and applies the exact date range client-side. Use `nyc` (DOB NOW) for current filings; BIS mostly holds older jobs.

**Do I need a Socrata app token?**  No. Anonymous requests work; a token only raises rate limits for very large pulls.

**Can I get every permit ever issued?**  Yes, leave the date filters empty and raise `maxResultsPerCity` (up to 100,000 per run). For full historical exports run once per city or per year range.

**Why are Dallas, Nashville, Baltimore or Kansas City missing?**  They either moved off Socrata or stopped updating their Socrata dataset. If they publish a Socrata dataset again it can be used through custom mode immediately.
