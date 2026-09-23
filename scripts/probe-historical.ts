// Checks whether this Odds API key can use the historical endpoints, and what they cost.
// Spends at most ~11 credits: one historical events call (1) and one historical odds call for
// spreads from US books (10). Never prints the key.
//
//   npx tsx --env-file=.env.local scripts/probe-historical.ts
export {};

const key = process.env.ODDS_API_KEY;
if (!key) {
  console.error("Set ODDS_API_KEY (e.g. in .env.local) first.");
  process.exit(1);
}

const BASE = "https://api.the-odds-api.com/v4/historical/sports/americanfootball_nfl";
// Tuesday before 2024 week 1: openers for the week should be on the board.
const DATE = "2024-09-03T16:00:00Z";

async function call(label: string, path: string, params: Record<string, string>) {
  const url = new URL(`${BASE}${path}`);
  url.search = new URLSearchParams({ apiKey: key!, date: DATE, ...params }).toString();
  const res = await fetch(url);
  const h = (n: string) => res.headers.get(n) ?? "?";
  console.log(`\n== ${label}: HTTP ${res.status} | cost ${h("x-requests-last")} | used ${h("x-requests-used")} | remaining ${h("x-requests-remaining")}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    console.log("   error:", JSON.stringify(body));
    return null;
  }
  return body as { timestamp: string; previous_timestamp: string; next_timestamp: string; data: any[] };
}

const events = await call("historical events", "/events", {});
if (events) {
  console.log(`   snapshot ${events.timestamp} (prev ${events.previous_timestamp}, next ${events.next_timestamp}); ${events.data.length} events`);
  for (const e of events.data.slice(0, 3)) console.log(`   ${e.commence_time}  ${e.away_team} at ${e.home_team}`);
}

const odds = await call("historical odds (spreads, us)", "/odds", { regions: "us", markets: "spreads", oddsFormat: "american" });
if (odds) {
  console.log(`   snapshot ${odds.timestamp}; ${odds.data.length} games`);
  const g = odds.data.find((e) => e.bookmakers?.length) ?? odds.data[0];
  if (g) {
    console.log(`   e.g. ${g.away_team} at ${g.home_team} (${g.commence_time}), ${g.bookmakers.length} books:`);
    for (const b of g.bookmakers.slice(0, 5)) {
      const o = b.markets[0]?.outcomes?.find((x: any) => x.name === g.home_team);
      console.log(`     ${b.title.padEnd(14)} home ${o?.point ?? "-"} (${o?.price ?? "-"})  updated ${b.last_update}`);
    }
  }
}
