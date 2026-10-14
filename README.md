# New Hire Finder MCP Server

[![Smithery](https://smithery.ai/badge/mambabuilt/mcp-new-hire-finder)](https://smithery.ai/servers/mambabuilt/mcp-new-hire-finder) [![Glama score](https://glama.ai/mcp/servers/mambalabsdev/mcp-new-hire-finder/badges/score.svg)](https://glama.ai/mcp/servers/mambalabsdev/mcp-new-hire-finder) [![MCP Registry](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fregistry.modelcontextprotocol.io%2Fv0%2Fservers%3Fsearch%3Dcom.mambabuilt%252Fmcp-new-hire-finder%26limit%3D1&query=%24.servers%5B0%5D._meta%5B%22io.modelcontextprotocol.registry%2Fofficial%22%5D.status&label=mcp%20registry&color=blue)](https://registry.modelcontextprotocol.io/v0/servers?search=com.mambabuilt/mcp-new-hire-finder&limit=1) [![npm version](https://img.shields.io/npm/v/@mambalabsdev/mcp-new-hire-finder)](https://www.npmjs.com/package/@mambalabsdev/mcp-new-hire-finder) [![npm downloads](https://img.shields.io/npm/dm/@mambalabsdev/mcp-new-hire-finder)](https://www.npmjs.com/package/@mambalabsdev/mcp-new-hire-finder) [![license](https://img.shields.io/github/license/mambalabsdev/mcp-new-hire-finder)](https://github.com/mambalabsdev/mcp-new-hire-finder/blob/main/LICENSE) [![mcpservers.org](https://img.shields.io/badge/mcpservers.org-listed-blue)](https://mcpservers.org/servers/mambalabsdev/mcp-new-hire-finder)

An MCP server for the Mamba Labs New Hire Finder actor on Apify. Find the people who started a role at a company in the last few months. Give a company domain, the titles you sell to, and a lookback window. Get one flat row per person: name, profile URL, title, start month, prior role, move type (new hire or internal promotion), and the source that found them.

## What's Inside

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Prerequisites](#prerequisites)
- [Example prompts](#example-prompts)
- [Tool](#tool)
- [Inputs](#inputs)
- [Pricing](#pricing)
- [Your keys](#your-keys)
- [Full actor documentation](#full-actor-documentation)
- [License](#license)

## What it does

Find people who started a role matching your titles at a company inside a lookback window. Give company_domain (or company_domains), target_titles, and lookback_months. Returns one flat, Clay-ready JSON row per person with name, profile URL, title, start month, prior role, move type (new hire, internal promotion, or announcement only), and source, plus one summary row per company that says whether anyone was found or why nothing could be looked up. Runs on your own Prospeo, Serper, SerpApi, or Exa keys passed as inputs, and on a people list you send; it never fetches LinkedIn and holds no key of its own. A run that does not succeed is returned as an error with its run ID. Read-only; requires an APIFY_TOKEN and consumes Apify credits per call.

All of the work runs on Apify. This package is a thin client that starts the actor run, waits for it, and hands back the dataset rows.

## Quick start

You need Node.js 18 or newer and an Apify account with an API token.

Add this to your Claude Desktop config (`claude_desktop_config.json`), Cursor, or any MCP client:

```json
{
  "mcpServers": {
    "mamba-new-hire-finder": {
      "command": "npx",
      "args": [
        "-y",
        "@mambalabsdev/mcp-new-hire-finder"
      ],
      "env": {
        "APIFY_TOKEN": "your-apify-token"
      }
    }
  }
}
```

Restart the client. The `find_new_hires` tool appears.

## Prerequisites

- Node.js 18 or newer.
- An Apify API token from [console.apify.com/account/integrations](https://console.apify.com/account/integrations), set as `APIFY_TOKEN`. The server lists its tool without a token; a call needs one.

## Example prompts

- "Who joined example.com in a marketing role in the last 6 months?"
- "Find new heads of content at these 10 companies since June."

## Tool

`find_new_hires`. One tool. Example arguments:

```json
{
  "company_domain": "example.com",
  "target_titles": [
    "marketing"
  ],
  "lookback_months": "6"
}
```

## Inputs

Every buyer facing input of the live actor, unchanged. Omitted inputs take the actor's own defaults.

| Input | Type | Required | Description |
|---|---|---|---|
| `company_domain` | string | no | One company domain, for example zapier.com. Use this or Company domains (batch); both are merged. |
| `company_domains` | array | no | A list of company domains. Each company gets its own summary row. |
| `company_name` | string | no | Optional, single company runs only. Leave empty and the name is read from the homepage. |
| `target_titles` | array | no | Title phrases to match, for example marketing, head of content, editor. A title matches when it contains every word of a phrase as a whole word. Also sent to Prospeo and web search as the title filter. |
| `seniority` | array | no | Optional. Keep only these seniority levels. |
| `departments` | array | no | Optional. Keep only these departments. |
| `exclude_titles` | array | no | Optional. Drop any title that contains one of these phrases, for example intern. |
| `expand_title_synonyms` | boolean | no | Also match a short synonym list (marketing also matches growth, brand, demand generation). Off by default, because every row is charged. |
| `lookback_months` | string | no | How many calendar months back to look, including this month. 1 to 24, default 6. 6 in October means May to October. Typed as text so Clay can send it. |
| `move_types` | array | no | Which moves to return and charge. new_hire is a person who came from another employer. promotion is a new role at the same employer. unknown is a hire announcement with no work history. Default new_hire only. |
| `include_year_only` | boolean | no | Also return people whose start is known only to the year and could fall inside the window. They are charged like any row. Off by default. |
| `people` | array | no | People you already hold, with role histories. Each item: person_name, company_domain, profile_url (optional), and roles, a list of {title, company_name, start (YYYY-MM), end (YYYY-MM or null)}. The same window, title, and move rules run on them, with no provider call. |
| `sources` | array | no | Routes to run. Default all. buyer_data is your people list; prospeo and web_search run only with your key; news, newsroom, and team_pages are free. |
| `prospeo_api_key` | string | no | Your own Prospeo key. Gives the work history behind start month and move type. One Prospeo credit per search page of 25 people and one per person enrichment, billed by Prospeo to you. Never stored. Your own key, sent as a run input; never stored by the actor. |
| `web_search_provider` | string | no | Which of your search keys to use. auto takes the first key present: Serper, then SerpApi, then Exa. |
| `serper_api_key` | string | no | Your own Serper.dev key for web search. One search per company by default. Search results carry no start date, so they are dated with your Prospeo key or counted as undated. Your own key, sent as a run input; never stored by the actor. |
| `serpapi_api_key` | string | no | Your own SerpApi key for web search. A different vendor from Serper. Your own key, sent as a run input; never stored by the actor. |
| `exa_api_key` | string | no | Your own Exa key. Exa people search returns work histories with start months, so its results need no enrichment. Your own key, sent as a run input; never stored by the actor. |
| `max_people_per_company` | string | no | Most person rows to return per company, newest starts first. 1 to 100, default 25. |
| `max_search_queries_per_company` | string | no | Web search queries per company on your key. 1 to 4, default 1. |
| `max_enrich_per_company` | string | no | Prospeo enrichment calls per company to date people found by web search, headlines, and team pages. 0 to 25, default 5. |
| `max_prospeo_pages_per_company` | string | no | Prospeo search pages of 25 people per company. 1 to 4, default 1. |
| `max_charge_usd` | number | no | Optional. The run stops before any charge that would take this run past this amount, and keeps every row already paid for. Leave empty to rely only on the maximum cost per run set in Apify, which the run also honors. |
| `skip_cache` | boolean | no | Search again even when the same company and filters ran in the last 7 days. A cached result is returned free. |

## Pricing

Pay per event on Apify, billed to your Apify account. Prices in USD.

| Event | Free plan | Bronze | Silver | Gold |
|---|---|---|---|---|
| `new_hire_found`, per person returned | $0.085 | $0.08075 | $0.0765 | $0.07225 |
| `apify-actor-start`, per run start | $0.001 | $0.001 | $0.001 | $0.001 |

## Your keys

The actor holds no provider key of its own. Every paid provider key is yours, passed as an input and stored by Apify as a secret input. Without a key, the actor skips that step and says so in the run.

## Full actor documentation

[apify.com/mambalabs/new-hire-finder](https://apify.com/mambalabs/new-hire-finder)

## License

MIT. See [LICENSE](LICENSE).
