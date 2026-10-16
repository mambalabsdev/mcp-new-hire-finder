#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(here, "..", "package.json"), "utf8"),
) as { version: string; name: string };

// Distinctive UA so Apify run meta.userAgent marks MCP-originated runs.
const USER_AGENT = `mambalabs-mcp ${pkg.name}@${pkg.version}`;

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
};

// Drop undefined values so optional inputs are not sent to the actor.
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// How long the actor run itself is allowed to take, in seconds. The suite's
// slowest measured run on 2026-09-22 was 152 s on a seven platform search, so
// 1800 s is roughly twelve times that: headroom for a slow day without letting a
// hung run bill indefinitely.
const ACTOR_RUN_TIMEOUT_SECS = 1800;

// How long this wrapper waits for that run, in milliseconds. The actor's own
// timeout plus two minutes, so the run's own TIMED-OUT status is what the
// caller sees rather than the wrapper giving up first and reporting nothing.
const WRAPPER_WAIT_MS = (ACTOR_RUN_TIMEOUT_SECS + 120) * 1000;
const POLL_INTERVAL_MS = 3000;

const TERMINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED", "ABORTING"]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Shared caller. actorPath is the actor's immutable Apify actor ID (a stable key
// that survives Store renames). The /v2/acts/{id} endpoint accepts it directly,
// so a Store rename never breaks these calls.
//
// START AND POLL, NOT RUN-SYNC. Apify's synchronous endpoints carry a platform
// ceiling of 300 seconds on the HTTP wait itself and answer 408 past it whatever
// the timeout parameter says, so a long run reads as a timeout even though the
// actor goes on to finish. Starting the run, polling it to a terminal status and
// then reading the dataset is the only way to wait as long as the actor needs.
//
// The token is read here rather than at module load, so the tool registers
// unconditionally and a server started without APIFY_TOKEN still advertises its
// capabilities instead of reporting none.
async function runActor(
  actorPath: string,
  actorLabel: string,
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const APIFY_TOKEN = process.env.APIFY_TOKEN;
  if (!APIFY_TOKEN) {
    return { isError: true, content: [{ type: "text", text: "APIFY_TOKEN is not set. Create a token at https://console.apify.com/account/integrations and set it as the APIFY_TOKEN environment variable." }] };
  }

  const headers = {
    Authorization: `Bearer ${APIFY_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };

  const httpError = async (response: Response): Promise<string> => {
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body?.error?.message) detail = ` ${body.error.message}`;
    } catch {
      detail = "";
    }
    switch (response.status) {
      case 400:
        return `The ${actorLabel} run was rejected as invalid input.${detail}`;
      case 401:
        return "Invalid Apify token. Check your APIFY_TOKEN environment variable.";
      case 402:
        return "Insufficient Apify credits. Check your account balance at https://console.apify.com/billing";
      default:
        return `Apify request to ${actorLabel} failed with status ${response.status}.${detail}`;
    }
  };

  // 1. Start the run.
  let started: Response;
  try {
    started = await fetch(
      `https://api.apify.com/v2/acts/${actorPath}/runs?timeout=${ACTOR_RUN_TIMEOUT_SECS}`,
      { method: "POST", headers, body: JSON.stringify(input) },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not reach the Apify API: ${message}` }] };
  }
  if (!started.ok) {
    return { isError: true, content: [{ type: "text", text: await httpError(started) }] };
  }

  let run: { id?: string; status?: string; defaultDatasetId?: string };
  try {
    run = ((await started.json()) as { data?: typeof run }).data ?? {};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned a response that could not be parsed: ${message}` }] };
  }
  const runId = run.id;
  if (!runId) {
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run start returned no run id, so there is nothing to wait for.` }] };
  }

  // 2. Poll to a terminal status.
  const deadline = Date.now() + WRAPPER_WAIT_MS;
  let status = run.status ?? "READY";
  let datasetId = run.defaultDatasetId;
  while (!TERMINAL.has(status)) {
    if (Date.now() >= deadline) {
      return {
        isError: true,
        content: [{ type: "text", text: `The ${actorLabel} run ${runId} was still ${status} after ${Math.round(WRAPPER_WAIT_MS / 1000)} seconds and this call stopped waiting. The run itself is still on Apify: read it at https://console.apify.com/actors/runs/${runId}` }],
      };
    }
    await sleep(POLL_INTERVAL_MS);
    let poll: Response;
    try {
      poll = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { isError: true, content: [{ type: "text", text: `Lost contact with the Apify API while waiting for ${actorLabel} run ${runId}: ${message}` }] };
    }
    if (!poll.ok) {
      return { isError: true, content: [{ type: "text", text: await httpError(poll) }] };
    }
    const body = (await poll.json()) as { data?: { status?: string; defaultDatasetId?: string } };
    status = body.data?.status ?? status;
    datasetId = body.data?.defaultDatasetId ?? datasetId;
  }

  // 3. A run that did not succeed is a failure the caller must see, never an
  // empty success. Surfacing it here is what keeps a crashed run from reading
  // as "no results found".
  if (status !== "SUCCEEDED") {
    return {
      isError: true,
      content: [{ type: "text", text: `The ${actorLabel} run did not succeed (run ID: ${runId}, status: ${status}).` }],
    };
  }
  if (!datasetId) {
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run ${runId} succeeded but reported no dataset, so there is nothing to return.` }] };
  }

  // 4. Read the dataset.
  let ds: Response;
  try {
    ds = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?format=json`, { headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `Could not read the ${actorLabel} dataset: ${message}` }] };
  }
  if (!ds.ok) {
    return { isError: true, content: [{ type: "text", text: await httpError(ds) }] };
  }

  let items: unknown;
  try {
    items = await ds.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run returned a response that could not be parsed: ${message}` }] };
  }

  if (!Array.isArray(items)) {
    const asObj = items as { error?: { type?: string; message?: string } };
    const detail = asObj?.error?.message
      ? `${asObj.error.message}`
      : JSON.stringify(items);
    return { isError: true, content: [{ type: "text", text: `The ${actorLabel} run did not return a dataset. ${detail}` }] };
  }

  return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
}

const server = new McpServer({
  name: "mamba-new-hire-finder",
  version: pkg.version,
});

// New Hire Finder (immutable actor ID cKuc38p4nYHNF3IW8). Every buyer facing input of the live actor
// is exposed; provider keys are the caller's own and go straight to the run.
server.registerTool(
  "find_new_hires",
  {
    title: "Find new hires",
    description:
      "Find people who started a role matching your titles at a company inside a lookback window. Give company_domain (or company_domains), target_titles, and lookback_months. Returns one flat, Clay-ready JSON row per person with name, profile URL, title, start month, prior role, move type (new hire, internal promotion, or announcement only), and source, plus one summary row per company that says whether anyone was found or why nothing could be looked up. Runs on your own Prospeo, Serper, SerpApi, or Exa keys passed as inputs, and on a people list you send; it never fetches LinkedIn and holds no key of its own. A run that does not succeed is returned as an error with its run ID. Reads public data and writes nothing; requires an APIFY_TOKEN and consumes Apify credits per call.",
    annotations: {
      title: "Find new hires",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      company_domain: z.string()
        .optional()
        .describe("One company domain, for example zapier.com. Use this or Company domains (batch); both are merged."),
      company_domains: z.array(z.string())
        .optional()
        .describe("A list of company domains. Each company gets its own summary row."),
      company_name: z.string()
        .optional()
        .describe("Optional, single company runs only. Leave empty and the name is read from the homepage."),
      target_titles: z.array(z.string())
        .optional()
        .describe("Title phrases to match, for example marketing, head of content, editor. A title matches when it contains every word of a phrase as a whole word. Also sent to Prospeo and web search as the title filter."),
      seniority: z.array(z.enum(["founder", "c_level", "vp", "director", "head", "manager", "other"]))
        .optional()
        .describe("Optional. Keep only these seniority levels."),
      departments: z.array(z.enum(["sales", "marketing", "engineering", "finance", "legal", "people", "operations", "product", "general"]))
        .optional()
        .describe("Optional. Keep only these departments."),
      exclude_titles: z.array(z.string())
        .optional()
        .describe("Optional. Drop any title that contains one of these phrases, for example intern."),
      expand_title_synonyms: z.boolean()
        .optional()
        .describe("Also match a short synonym list (marketing also matches growth, brand, demand generation). Off by default, because every row is charged."),
      lookback_months: z.string()
        .optional()
        .describe("How many calendar months back to look, including this month. 1 to 24, default 6. 6 in October means May to October. Typed as text so Clay can send it."),
      move_types: z.array(z.enum(["new_hire", "promotion", "unknown"]))
        .optional()
        .describe("Which moves to return and charge. new_hire is a person who came from another employer. promotion is a new role at the same employer. unknown is a hire announcement with no work history. Default new_hire only."),
      include_year_only: z.boolean()
        .optional()
        .describe("Also return people whose start is known only to the year and could fall inside the window. They are charged like any row. Off by default."),
      people: z.array(z.record(z.string(), z.unknown()))
        .optional()
        .describe("People you already hold, with role histories. Each item: person_name, company_domain, profile_url (optional), and roles, a list of {title, company_name, start (YYYY-MM), end (YYYY-MM or null)}. The same window, title, and move rules run on them, with no provider call."),
      sources: z.array(z.enum(["buyer_data", "prospeo", "web_search", "news", "newsroom", "team_pages"]))
        .optional()
        .describe("Routes to run. Default all. buyer_data is your people list; prospeo and web_search run only with your key; news, newsroom, and team_pages are free."),
      prospeo_api_key: z.string()
        .optional()
        .describe("Your own Prospeo key. Gives the work history behind start month and move type. One Prospeo credit per search page of 25 people and one per person enrichment, billed by Prospeo to you. Never stored. Your own key, sent as a run input; never stored by the actor."),
      web_search_provider: z.enum(["auto", "serper", "serpapi", "exa"])
        .optional()
        .describe("Which of your search keys to use. auto takes the first key present: Serper, then SerpApi, then Exa."),
      serper_api_key: z.string()
        .optional()
        .describe("Your own Serper.dev key for web search. One search per company by default. Search results carry no start date, so they are dated with your Prospeo key or counted as undated. Your own key, sent as a run input; never stored by the actor."),
      serpapi_api_key: z.string()
        .optional()
        .describe("Your own SerpApi key for web search. A different vendor from Serper. Your own key, sent as a run input; never stored by the actor."),
      exa_api_key: z.string()
        .optional()
        .describe("Your own Exa key. Exa people search returns work histories with start months, so its results need no enrichment. Your own key, sent as a run input; never stored by the actor."),
      max_people_per_company: z.string()
        .optional()
        .describe("Most person rows to return per company, newest starts first. 1 to 100, default 25."),
      max_search_queries_per_company: z.string()
        .optional()
        .describe("Web search queries per company on your key. 1 to 4, default 1."),
      max_enrich_per_company: z.string()
        .optional()
        .describe("Prospeo enrichment calls per company to date people found by web search, headlines, and team pages. 0 to 25, default 5."),
      max_prospeo_pages_per_company: z.string()
        .optional()
        .describe("Prospeo search pages of 25 people per company. 1 to 4, default 1."),
      max_charge_usd: z.number()
        .optional()
        .describe("Optional. The run stops before any charge that would take this run past this amount, and keeps every row already paid for. Leave empty to rely only on the maximum cost per run set in Apify, which the run also honors."),
      skip_cache: z.boolean()
        .optional()
        .describe("Search again even when the same company and filters ran in the last 7 days. A cached result is returned free."),
    },
  },
  async (args) => runActor("cKuc38p4nYHNF3IW8", "New Hire Finder", compact(args as Record<string, unknown>)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
