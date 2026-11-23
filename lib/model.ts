// Signal Radar — valuation model for token-radar-01.
//
// The board ranks protocols that record no token, by an implied value built
// only from the sealed snapshot's own figures. No protocol name is ever
// special-cased: one function scores every row.
//
// How the number is built (the dashboard states the same formula):
//
//   peers      = protocols whose token already trades (mcap_usd set, tvl > 0),
//                outside exchange / bridge categories; multiple = mcap / tvl.
//   global     = median peer multiple, winsorised at the 90th percentile.
//   category   = median multiple of the protocol's own category, shrunk toward
//                the global median with a prior of 8 peers. Fewer than 3 peers
//                in a category and the global median is used alone.
//   growth     = 1 + 0.5 * clamp(change_7d, -0.40, +0.80); unknown change -> 1.
//   maturity   = 0.70 + 0.30 * min(days listed, 730) / 730; unknown age -> 365.
//   breadth    = 1 + 0.04 * min(chains - 1, 5); one chain scores 1.00.
//   implied    = round(tvl * multiple * growth * maturity * breadth)
//
// Confidence is high when the category has 8+ peers, medium at 3+, low
// below that. The board is the snapshot watchlist (all 40 slugs) plus the
// strongest pre-token protocols below the floor, by TVL, up to 200 rows.

/** One protocol entry, exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  prior_peers: number;
  min_category_peers: number;
  winsor_percentile: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  early_rows: number;
}

export const MODEL: ModelConstants = {
  prior_peers: 8,
  min_category_peers: 3,
  winsor_percentile: 0.9,
  growth_weight: 0.5,
  growth_floor: -0.4,
  growth_cap: 0.8,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 730,
  unknown_age_days: 365,
  breadth_per_chain: 0.04,
  breadth_max_chains: 5,
  early_rows: 160,
};

export const MODEL_VERSION = 'signal-2';

/** Clamp a number into [lo, hi]. */
function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Median of a sorted ascending array. */
function medianOf(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Days between a UTC date string and the snapshot date, or null. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.floor((a - b) / 86_400_000));
}

/** A protocol records no token in the snapshot. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Categories whose TVL is not protocol value (reserves, wrappers, bridges). */
const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

/** A name that marks a version, a wrapped/staked product, or an exchange. */
const VERSION_MARK = /\s(v\d+|V\d+|\d+\.\d+)\s*$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX =
  /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

/** A pre-token protocol that is a plausible launch subject, by the same
 *  plausibility rules the snapshot's own watchlist uses. */
export function isPlausible(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_MARK.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The peer set: multiples of token protocols, winsorised at the cap. */
export interface PeerStats {
  globalMultiple: number;
  byCategory: Map<string, { multiple: number; peers: number }>;
}

export function peerStats(
  protocols: SnapshotProtocol[],
  model: ModelConstants = MODEL,
): PeerStats {
  const all: number[] = [];
  const perCat = new Map<string, number[]>();
  for (const p of protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) continue;
    const m = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(m) || m <= 0) continue;
    all.push(m);
    if (p.category !== null) {
      const list = perCat.get(p.category) ?? [];
      list.push(m);
      perCat.set(p.category, list);
    }
  }
  all.sort((a, b) => a - b);
  const capAt = all[Math.min(all.length - 1, Math.floor(all.length * model.winsor_percentile))] ?? 1;
  const winsorised = all.map((m) => Math.min(m, capAt));
  const globalMultiple = medianOf(winsorised);
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [cat, list] of perCat) {
    const capped = list.map((m) => Math.min(m, capAt)).sort((a, b) => a - b);
    const catMedian = medianOf(capped);
    const n = capped.length;
    const shrunk =
      n >= model.min_category_peers
        ? (n * catMedian + model.prior_peers * globalMultiple) / (n + model.prior_peers)
        : globalMultiple;
    byCategory.set(cat, { multiple: shrunk, peers: n });
  }
  return { globalMultiple, byCategory };
}

/** One scored row: the figures the dashboard shows and recomputes from. */
export interface ScoredRow {
  slug: string;
  name: string;
  rank: number;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  multiple: number;
  growth_factor: number;
  maturity_factor: number;
  breadth_factor: number;
  implied_value_usd: number;
  confidence: 'high' | 'medium' | 'low';
  on_watchlist: boolean;
}

/** Score one protocol with the peer model. */
export function scoreProtocol(
  p: SnapshotProtocol,
  stats: PeerStats,
  asOf: string,
  onWatchlist: boolean,
  model: ModelConstants = MODEL,
): ScoredRow {
  const cat = p.category === null ? null : stats.byCategory.get(p.category);
  const multiple = cat === null || cat === undefined ? stats.globalMultiple : cat.multiple;
  const peers = cat === null || cat === undefined ? 0 : cat.peers;
  // change_7d is in per cent in the snapshot: divide by 100 first.
  const growth =
    p.change_7d === null
      ? 1
      : 1 + model.growth_weight * clamp(p.change_7d / 100, model.growth_floor, model.growth_cap);
  const age = ageDays(asOf, p.listed_at) ?? model.unknown_age_days;
  const maturity =
    model.maturity_floor +
    model.maturity_range * Math.min(age, model.maturity_days) / model.maturity_days;
  const breadth = 1 + model.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_chains);
  const implied = Math.max(
    1,
    Math.min(100_000_000_000_000, Math.round(p.tvl_usd * multiple * growth * maturity * breadth)),
  );
  const confidence = peers >= 8 ? 'high' : peers >= model.min_category_peers ? 'medium' : 'low';
  return {
    slug: p.slug,
    name: p.name,
    rank: 0,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: ageDays(asOf, p.listed_at),
    multiple,
    growth_factor: growth,
    maturity_factor: maturity,
    breadth_factor: breadth,
    implied_value_usd: implied,
    confidence,
    on_watchlist: onWatchlist,
  };
}

/** Build the ranked board: the whole watchlist first by value, then the
 *  strongest plausible pre-token protocols below the floor, by TVL. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): ScoredRow[] {
  const stats = peerStats(snapshot.protocols, model);
  const watch = new Set(snapshot.watchlist);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const rows: ScoredRow[] = [];
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p === undefined) continue;
    rows.push(scoreProtocol(p, stats, snapshot.as_of, true, model));
  }
  const early = snapshot.protocols
    .filter((p) => !watch.has(p.slug) && isPlausible(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, model.early_rows);
  for (const p of early) rows.push(scoreProtocol(p, stats, snapshot.as_of, false, model));
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd);
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

/** Farm steps, derived from the protocol's own category and chains.
 *  Every step is concrete: what to do, what it costs, how long it takes. */
export function farmSteps(row: ScoredRow): string[] {
  const name = row.name;
  const chain = row.chains[0] ?? 'its main chain';
  const chains = row.chains.slice(0, 3).join(', ');
  const cat = (row.category ?? '').toLowerCase();
  const steps: string[] = [];
  const push = (s: string) => {
    if (s.length >= 20 && s.length <= 600) steps.push(s);
  };

  push(
    `Set up a wallet on ${chain} and bridge about $200 of a major stablecoin there; bridging usually costs $2-8 in gas and takes 5-15 minutes.`,
  );
  if (cat.includes('dex')) {
    push(
      `Swap about $100 through ${name} on ${chain} once a week for four weeks, keeping each trade above $25 so the volume counts; expect $1-4 of fees per swap.`,
    );
    push(
      `Add about $100 of liquidity to one ${name} pool on ${chain} and leave it in place for at least 30 days; watch impermanent loss weekly for 10 minutes.`,
    );
  } else if (cat.includes('lend')) {
    push(
      `Supply about $150 of a stablecoin to ${name} on ${chain} and keep the position open for at least 30 days; supplying costs about $2-5 in gas once.`,
    );
    push(
      `Borrow a small amount, about $30, against that supply once, then repay it within a week so the account shows both sides of the market; interest is a few cents a day.`,
    );
  } else if (cat.includes('yield') || cat.includes('farm')) {
    push(
      `Deposit about $150 into the highest-TVL ${name} vault on ${chain} and leave it compounding for at least 30 days; the deposit costs about $2-6 in gas.`,
    );
    push(
      `Claim or restake the vault's yield once a week for four weeks, about 10 minutes each time, so the account shows repeated use rather than one deposit.`,
    );
  } else if (cat.includes('staking') || cat.includes('restak')) {
    push(
      `Stake about $150 through ${name} on ${chain} and hold the position for at least 30 days; staking costs about $2-5 in gas and unstaking can take days.`,
    );
  } else if (cat.includes('perpetual') || cat.includes('derivative')) {
    push(
      `Open a small perpetual position of about $50 notional on ${name} (${chain}), close it within a day, and repeat once a week for a month; each round trip costs roughly $1-3 in fees.`,
    );
  } else if (cat.includes('bridge')) {
    push(
      `Bridge about $100 through ${name} to ${chain} and back once a week for four weeks, keeping each transfer above $50; each crossing costs about $2-6 in fees.`,
    );
  } else {
    push(
      `Use ${name} on ${chain} with about $100 at least once a week for four weeks, doing the protocol's main action each time; budget $1-5 of fees per use.`,
    );
    push(
      `Keep a position of about $100 open on ${name} for at least 30 days instead of withdrawing after one day, so the activity reads as sustained use.`,
    );
  }
  if (row.chains.length > 1) {
    push(
      `Do the same flow on a second chain where ${name} runs (${chains}) at least once, with about $50, so the wallet is active on more than one network.`,
    );
  } else {
    push(
      `If ${name} expands to a second chain, repeat the same flow there once with about $50 within the first week, so the wallet is active on more than one network.`,
    );
  }
  push(
    `Once a week, spend 15 minutes checking ${name}'s own announcements and points page for new tasks, quests or multipliers, and finish any that cost under $5.`,
  );
  push(
    `Keep records: save every transaction hash and a screenshot of the position, and never pay anyone who offers to farm for you; airdrops are claimed from the protocol itself, never by sending funds.`,
  );
  return steps.slice(0, 8);
}

/** The board.json row the gate reads. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export function toBoardRows(scored: ScoredRow[]): BoardRow[] {
  return scored.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: farmSteps(r),
  }));
}

/** The gate's own rules, re-checked before anything is written. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, need 100 to 4000`;
  const seen = new Set<string>();
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `row ${i} has rank ${r.rank}, need ${i + 1}`;
    if (!slugs.has(r.slug)) return `row ${i} names unknown slug ${r.slug}`;
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice`;
    seen.add(r.slug);
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `implied value rises at rank ${r.rank}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `row ${r.slug} has ${r.farm_steps.length} farm steps`;
    }
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  if (board.length > 1 && board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) {
    return 'every implied value is the same';
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing`;
  }
  return null;
}

/** Parse and validate the snapshot document. */
export function parseSnapshot(text: string): Snapshot {
  const doc = JSON.parse(text) as Snapshot;
  if (!Array.isArray(doc.protocols) || !Array.isArray(doc.watchlist)) {
    throw new Error('snapshot has no protocols/watchlist arrays');
  }
  return doc;
}

/** The dashboard's data file: every row with the figures the page shows. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  median_multiple: number;
  rows: ScoredRow[];
  board: BoardRow[];
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const stats = peerStats(snapshot.protocols);
  const scored = buildBoard(snapshot);
  const board = toBoardRows(scored);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    median_multiple: stats.globalMultiple,
    rows: scored,
    board,
  };
  return { board, radar };
}

/** data.js: the page's only input, written beside the dashboard. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR_DATA = ${JSON.stringify(radar)};\n`;
}
