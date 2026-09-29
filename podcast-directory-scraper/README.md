# Podcast Directory Scraper

Search the Apple Podcasts directory by keyword, genre or show ID and get clean JSON for every show, including the full episode list from its public RSS feed. No API key, no login, no browser. Pay only for the shows and episodes you actually receive.

## What does Podcast Directory Scraper do?

Podcast Directory Scraper combines two public sources into one structured dataset:

1. **Apple's iTunes Search API** for discovery. Give it search terms (for example `construction business`), an optional Apple genre ID and a storefront country, or pass Apple podcast IDs directly. It returns show-level metadata: title, publisher, artwork, Apple Podcasts URL, genres, total episode count and latest release date.
2. **The show's RSS feed** for depth. The Actor fetches the `feedUrl` Apple reports (or any RSS URL you supply) and parses it with a fast XML parser. From the feed it extracts the show description, website, language, explicit flag and iTunes categories, plus one object per episode with GUID, title, plain-text description, publish date, duration in seconds, audio URL, MIME type, file size, season and episode numbers and the episode web page.

You get one dataset item per show with a nested `episodes` array, sorted newest first. Descriptions are converted from HTML to plain text and episode descriptions are capped at 2,000 characters so the output stays compact. Dates are ISO 8601, durations are integers, and every record carries a `scrapedAt` timestamp.

Feeds are fetched five at a time with a 20 second timeout and automatic retries. If a feed is missing, returns 404 or is not valid RSS, the show is still pushed with its Apple metadata, an empty `episodes` array and the reason in `feedError`.

## Why scrape podcast data?

- **Guest and sponsorship outreach**: build a list of every active show in your niche, see how often they publish and how long episodes run before you pitch.
- **Competitive and market research**: track which topics, publishers and categories dominate a keyword across countries.
- **Content discovery and curation**: feed a newsletter, directory or recommendation engine with fresh episodes filtered by date.
- **Audio and NLP pipelines**: collect direct MP3 URLs and metadata for transcription, summarization or search indexing.
- **Monitoring**: schedule a daily run with `episodesPublishedAfter` to catch new episodes from a fixed list of shows.

## Input

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `searchTerms` | array of strings | `["construction business"]` | Keywords searched in the Apple directory. Each term returns up to 200 shows. |
| `podcastIds` | array of strings | `[]` | Apple collection IDs (the number after `/id` in a podcasts.apple.com URL). |
| `feedUrls` | array of strings | `[]` | RSS feed URLs to parse directly, without Apple metadata. |
| `country` | string | `US` | Two-letter Apple storefront code (US, GB, CA, AU, DE, ...). |
| `genreId` | string | | Apple genre ID, e.g. `1321` Business, `1318` Technology, `1304` Education. |
| `maxShows` | integer | `50` | Stop after this many unique shows. |
| `includeEpisodes` | boolean | `true` | Parse RSS feeds and include the `episodes` array. |
| `maxEpisodesPerShow` | integer | `50` | Newest episodes kept first. `0` means all. |
| `episodesPublishedAfter` | string | | ISO date `YYYY-MM-DD`. Older episodes are skipped and not charged. |

Any combination of `searchTerms`, `podcastIds` and `feedUrls` is allowed; results are de-duplicated by Apple ID and feed URL.

Example input:

```json
{
  "searchTerms": ["structured cabling"],
  "country": "US",
  "maxShows": 3,
  "includeEpisodes": true,
  "maxEpisodesPerShow": 5
}
```

## Output example

One item per show. This record comes from a real run of the input above.

```json
{
  "appleId": "1503407642",
  "title": "Benefits of Structured Cabling System",
  "publisher": "Amit Singh",
  "description": "What are the benefits of a structured cabling system? Find Out!",
  "feedUrl": "https://anchor.fm/s/1629b4c0/podcast/rss",
  "appleUrl": "https://podcasts.apple.com/us/podcast/benefits-of-structured-cabling-system/id1503407642?uo=4",
  "artworkUrl": "https://is1-ssl.mzstatic.com/image/thumb/Podcasts123/v4/c2/f5/34/c2f5347a-9893-0b84-ad51-f4e90f8f1c53/mza_1932606179285332517.jpg/600x600bb.jpg",
  "websiteUrl": "https://podcasters.spotify.com/pod/show/amit-singh4",
  "language": "en",
  "explicit": false,
  "genres": ["Business"],
  "categories": ["Business"],
  "episodeCount": 1,
  "latestEpisodeDate": "2020-03-13T11:36:00.000Z",
  "country": "US",
  "feedError": null,
  "episodes": [
    {
      "guid": "https://anchor.fm/amit-singh4/episodes/Benefits-of-Structured-Cabling-System-ebg6gv",
      "title": "Benefits of Structured Cabling System",
      "description": "Did you know the benefits of a structured cabling system? Patwa Kinarivala Electronics LTD shares 5 main benefits for offices to have a Structured Cabling System. Find Out More!",
      "publishedAt": "2020-03-13T11:36:50.000Z",
      "durationSeconds": 286,
      "audioUrl": "https://anchor.fm/s/1629b4c0/podcast/play/11065311/https%3A%2F%2Fd3ctxlq1ktw2nl.cloudfront.net%2Fproduction%2F2020-2-13%2F56379038-22050-1-611633f32c573.mp3",
      "audioType": "audio/mpeg",
      "audioSizeBytes": 1435342,
      "episodeNumber": null,
      "seasonNumber": null,
      "episodeUrl": "https://podcasters.spotify.com/pod/show/amit-singh4/episodes/Benefits-of-Structured-Cabling-System-ebg6gv",
      "explicit": false
    }
  ],
  "scrapedAt": "2026-09-29T15:37:41.557Z"
}
```

`genres` come from Apple, `categories` from the feed's `itunes:category` tags (nested ones appear as `Parent > Child`). `episodeCount` is Apple's total for the show, while `episodes` holds only the episodes you asked for. Shows added through `feedUrls` have `appleId`, `appleUrl` and `country` set to `null`.

## How much does it cost?

The Actor uses pay-per-event pricing with two events:

- **`show`**: $0.02 per show pushed to the dataset.
- **`episode`**: $0.0005 per episode included in a show's `episodes` array.

A typical run of 50 shows with 50 episodes each costs about $2.25 (50 × $0.02 + 2,500 × $0.0005). Set `includeEpisodes` to `false` to pay for shows only, or use `maxEpisodesPerShow` and `episodesPublishedAfter` to control the episode count. Platform usage (compute, storage) is billed separately under your Apify plan.

## Legal and fair use

The Actor reads only public sources: the Apple iTunes Search API, which is openly documented and requires no key, and RSS feeds that podcasters publish so that any app can subscribe. It collects show and episode metadata that is already public and does not extract or store personal data; in particular, the owner e-mail address that many feeds contain is deliberately dropped. Requests carry an identifying user-agent, feeds are fetched with limited concurrency and one request per show, and 404s are not retried. Please respect the terms of Apple and of individual feed hosts, do not re-host audio without permission, and keep run frequency reasonable.

## Integrations and API

Everything the Actor produces is available through the Apify platform:

- **Apify API and clients**: start runs and fetch the dataset as JSON, CSV or Excel from any language with the REST API or the JavaScript and Python clients.
- **Scheduling**: run it hourly, daily or weekly from the Apify Console and combine with `episodesPublishedAfter` to collect only new episodes.
- **Webhooks**: trigger your own endpoint, a Slack message or another Actor when a run finishes.
- **Integrations**: connect the dataset to Google Sheets, Airtable, Make, Zapier, n8n or a database with the built-in integrations.
- **MCP and AI agents**: expose the Actor as a tool through the Apify MCP server so an AI agent can look up podcasts on demand.

## FAQ

**Do I need an Apple developer account or API key?**
No. The iTunes Search API is public and the Actor uses it anonymously.

**Why does a show have an empty `episodes` array?**
Either `includeEpisodes` is off, the date filter removed every episode, or the feed could not be fetched. In the last case `feedError` explains why (for example `HTTP 404` or `Not an RSS feed`). You are only charged the `show` event for such records.

**Can I scrape a podcast that is not on Apple Podcasts?**
Yes. Put its RSS URL in `feedUrls`. Show metadata is then taken from the feed itself.

**How many results can one search term return?**
Apple caps a search at 200 shows. Use several narrower terms, different `country` values or a `genreId` to reach more shows.

**Are Atom feeds supported?**
No, only RSS 2.0 podcast feeds, which is what Apple, Spotify and all podcast hosts publish. Atom feeds are reported in `feedError`.

**Does it download audio files?**
No. It returns the direct `audioUrl` so you can download or stream in your own pipeline.

**Is there a rate limit?**
Apple limits the search API to roughly 20 requests per minute. The Actor makes one request per search term and one per 100 IDs, and retries with backoff if it is throttled.
