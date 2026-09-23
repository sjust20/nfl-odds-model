-- Historical sportsbook odds (The Odds API), kept private in Neon Postgres: the provider's terms
-- allow storing data indefinitely but not redistributing it raw, so it stays out of the public repo.
-- Apply with: npx tsx --env-file=.env.local scripts/history/odds-history.ts migrate

-- One API response: every game on the board at one moment.
create table if not exists odds_snapshots (
  snapshot_ts       timestamptz primary key,   -- snapshot time reported by the API (live tests: fetch time)
  source            text not null check (source in ('historical', 'live')),
  requested_for     timestamptz,               -- the `date` we asked for (the API returns the latest snapshot at or before it)
  previous_ts       timestamptz,
  next_ts           timestamptz,
  markets           text not null,
  bookmakers        text not null,
  credits_cost      int,
  credits_remaining int,
  event_count       int not null,
  fetched_at        timestamptz not null default now(),
  raw               jsonb not null
);

-- One book's line for one game in one snapshot. Teams use nflverse abbreviations, and spreads use
-- the app's convention: `line` = points the home team is favored by.
create table if not exists odds_lines (
  snapshot_ts   timestamptz not null references odds_snapshots (snapshot_ts) on delete cascade,
  event_id      text not null,
  game_id       text,                          -- nflverse game_id; null if the event couldn't be matched
  commence_time timestamptz not null,
  home          text not null,
  away          text not null,
  bookmaker     text not null,
  market        text not null check (market in ('spreads', 'totals')),
  last_update   timestamptz,
  line          numeric,                       -- spreads: home favored by; totals: the total
  home_price    int,                           -- spreads only
  away_price    int,
  over_price    int,                           -- totals only
  under_price   int,
  primary key (snapshot_ts, event_id, bookmaker, market)
);
create index if not exists odds_lines_game on odds_lines (game_id, market, bookmaker, snapshot_ts);

-- What to download: an opening snapshot per week and a closing snapshot per kickoff time.
create table if not exists download_plan (
  target_ts   timestamptz primary key,
  kind        text not null check (kind in ('open', 'close')),
  season      int not null,
  week        int not null,
  games       text[] not null,                 -- nflverse game_ids this snapshot is for
  status      text not null default 'pending' check (status in ('pending', 'done', 'error')),
  snapshot_ts timestamptz references odds_snapshots (snapshot_ts),
  attempts    int not null default 0,
  error       text,
  updated_at  timestamptz not null default now()
);

-- Opening and closing line per game, book and market.
create or replace view game_open_close as
with planned as (
  select kind, snapshot_ts, unnest(games) as game_id
  from download_plan
  where status = 'done'
)
select
  p.game_id,
  l.market,
  l.bookmaker,
  max(l.line)        filter (where p.kind = 'open')  as open_line,
  max(l.line)        filter (where p.kind = 'close') as close_line,
  max(l.home_price)  filter (where p.kind = 'open')  as open_home_price,
  max(l.home_price)  filter (where p.kind = 'close') as close_home_price,
  max(l.over_price)  filter (where p.kind = 'open')  as open_over_price,
  max(l.over_price)  filter (where p.kind = 'close') as close_over_price,
  max(l.last_update) filter (where p.kind = 'open')  as open_updated,
  max(l.last_update) filter (where p.kind = 'close') as close_updated
from planned p
join odds_lines l on l.snapshot_ts = p.snapshot_ts and l.game_id = p.game_id
group by p.game_id, l.market, l.bookmaker;
