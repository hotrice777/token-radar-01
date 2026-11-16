// The token radar's model: a sealed snapshot in, a ranked board out.
//
// The board ranks every slug on the snapshot's watchlist — the floor, never a
// ceiling — and adds the pre-token protocols below that floor the radar exists
// to find. A protocol counts as pre-token when its record carries no token at
// all: no market cap, no CoinGecko id, no symbol. Protocols that already trade
// are kept apart and shown with the market's own values, never mixed into the
// ranked board.
//
// Implied value is a function of the snapshot's own figures only:
//   base       = tvl_usd x baseMultiple
//   weekly     = clamp(change_7d, growthFloor, growthCap) per cent
//   growthMult = 1 + (weekly / 100) x growthWeight
//   maturity   = maturityFloor + min(age_days, maturityDays) / maturityDays x maturityRange
//                (age unknown: unknownAgeDays)
//   implied    = max(1, round(base x growthMult x maturity))
//
// The constants are the house model's, stated in the dashboard and adjustable
// in the model sandbox. No protocol name is ever special-cased: one function
// scores every row.

/** A day in milliseconds, for turning listed dates into ages. */
const MS_PER_DAY = 86_400_000;

/** The model's parameters, as the dashboard states them and the sandbox may change them. */
export interface ModelParams {
  base_multiple: number; // share of TVL the model starts from
  growth_weight: number; // how much the seven-day change moves the value
  growth_floor: number; // lowest weekly change the model counts, per cent
  growth_cap: number; // highest weekly change the model counts, per cent
  maturity_floor: number; // the multiplier a brand-new protocol gets
  maturity_range: number; // how much the multiplier grows with age
  maturity_days: number; // age at which the multiplier stops growing, in days
  unknown_age_days: number; // the age assumed when no listing date is known
}

/** The house model's parameters, built in the dashboard's key order. */
function modelParams(
  baseMultiple: number,
  growthWeight: number,
  growthFloor: number,
  growthCap: number,
  maturityFloor: number,
  maturityRange: number,
  maturityDays: number,
  unknownAgeDays: number,
): ModelParams {
  return {
    base_multiple: baseMultiple,
    growth_weight: growthWeight,
    growth_floor: growthFloor,
    growth_cap: growthCap,
    maturity_floor: maturityFloor,
    maturity_range: maturityRange,
    maturity_days: maturityDays,
    unknown_age_days: unknownAgeDays,
  };
}

export const MODEL = modelParams(0.25, 0.5, -60, 120, 0.6, 0.4, 1095, 365);

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-1';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One protocol entry from the snapshot: exactly the ten fields the sealed input carries. */
export interface ProtocolEntry {
  slug: string; // DefiLlama slug, the board's key
  name: string; // display name
  category: string | null; // DefiLlama category, or null when unclassified
  chains: string[]; // chains the protocol runs on; the first is its main chain
  tvl_usd: number; // total value locked, in dollars
  change_7d: number | null; // seven-day TVL change, per cent, or null
  mcap_usd: number | null; // market cap, set only when the protocol already has a token
  listed_at: string | null; // first listing date, YYYY-MM-DD, or null
  gecko_id: string | null; // CoinGecko id, or null when there is no token
  symbol: string | null; // token symbol, or null when there is no token
}

/** The whole snapshot document. */
export interface SnapshotDoc {
  as_of: string; // the snapshot's date, YYYY-MM-DD
  source: string; // where the snapshot came from
  floor_usd: number; // the watchlist's TVL floor, in dollars
  protocols: ProtocolEntry[]; // every protocol the snapshot indexes
  watchlist: string[]; // the watchlist's slugs, in the snapshot's order
}

/** One step of a farm plan: the action, what it costs, and how long it takes. */
export interface PlanStep {
  text: string; // what to do
  cost: string; // what it costs, in plain dollars
  time: string; // how long it takes
}

/** One row of board.json: the ranked board's row. */
export interface ScoredRow {
  rank: number; // 1-based, strongest implied value first
  slug: string; // DefiLlama slug
  name: string; // display name
  category: string | null; // DefiLlama category, or null when unclassified
  chains: string[]; // chains the protocol runs on
  tvl_usd: number; // total value locked, in dollars
  change_7d: number | null; // seven-day TVL change, per cent, or null
  mcap_usd: number | null; // market cap; null on a pre-token row
  listed_at: string | null; // first listing date, or null
  gecko_id: string | null; // CoinGecko id; null on a pre-token row
  symbol: string | null; // token symbol; null on a pre-token row
  token_status: 'pre-token'; // the board only ranks pre-token rows
  age_days: number | null; // days since listing, or null when unknown
  implied_value_usd: number; // the model's value, whole dollars
  model: { // the inputs the value was computed from
    base_multiple: number; // the base multiple in force
    growth_pct: number; // the clamped weekly change, per cent
    growth_multiplier: number; // 1 + growth_pct / 100 x growth_weight, four decimals
    maturity_multiplier: number; // the age multiplier, four decimals
    age_days: number | null; // the age used, or null when unknown
  };
  farm_steps: string[]; // the six-step farm plan, as display strings
}

/** The dashboard's compact view of one row, with the farm plan generated in the page. */
export interface PageRow {
  rank: number; // 1-based, strongest implied value first
  slug: string; // DefiLlama slug
  name: string; // display name
  category: string | null; // DefiLlama category, or null when unclassified
  chains: string[]; // chains the protocol runs on
  tvl_usd: number; // total value locked, in dollars
  change_7d: number | null; // seven-day TVL change, per cent, or null
  mcap_usd: number | null; // market cap; null on a pre-token row
  listed_at: string | null; // first listing date, or null
  age_days: number | null; // days since listing, or null when unknown
  implied_value_usd: number; // the model's value, whole dollars
  growth_multiplier: number; // the growth multiplier board.json carries
  maturity_multiplier: number; // the maturity multiplier board.json carries
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveEntry {
  slug: string; // DefiLlama slug
  name: string; // display name
  category: string | null; // DefiLlama category, or null when unclassified
  chains: string[]; // chains the protocol runs on
  tvl_usd: number; // total value locked, in dollars
  mcap_usd: number | null; // market cap, the value the page shows
  change_7d: number | null; // seven-day TVL change, per cent, or null
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarPayload {
  as_of: string; // the snapshot's date
  source: string; // where the snapshot came from
  floor_usd: number; // the watchlist's TVL floor, in dollars
  model: ModelParams; // the house model the board was built with
  model_version: string; // the model's version label
  watchlist_size: number; // how many slugs the watchlist holds
  board_size: number; // how many rows the board holds
  early_size: number; // how many board rows came from below the floor
  live_size: number; // how many live-token protocols were set aside
  rows: PageRow[]; // the ranked board, compact
  live: LiveEntry[]; // the live-token protocols, by market cap
}

/** Why a snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** `value` when it is a finite number, `fallback` otherwise. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** `value` clamped into [`lo`, `hi`]. */
function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Whole days from `listedAt` to `asOf`, never below zero; null when either date is absent or bad. */
export function daysSinceListed(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const listed = Date.parse(listedAt + 'T00:00:00Z');
  const asOfDay = Date.parse(asOf + 'T00:00:00Z');
  if (!Number.isFinite(listed) || !Number.isFinite(asOfDay)) return null;
  const days = Math.floor((asOfDay - listed) / MS_PER_DAY);
  return days < 0 ? 0 : days;
}

/** Four-decimal rounding, for the multipliers the board carries. */
function to4dp(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function scoreOne(entry: ProtocolEntry, asOf: string, model: ModelParams): { value: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = daysSinceListed(asOf, entry.listed_at);
  const growthPct = clamp(numOr(entry.change_7d, 0), model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const knownAge = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (clamp(knownAge, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const value = Math.max(1, Math.round(entry.tvl_usd * model.base_multiple * growthMult * maturityMult));
  return { value, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(v\d+(\.\d+)?|V\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function hasNoToken(p: ProtocolEntry): boolean {
  return [p.mcap_usd, p.gecko_id, p.symbol].every((v) => v === null);
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function canRank(p: ProtocolEntry): boolean {
  if (!hasNoToken(p)) return false;
  if (p.category === 'CEX') return false;
  return !VERSIONED.test(p.name);
}

/** The snapshot's protocols by slug. */
function indexBySlug(entries: ProtocolEntry[]): Map<string, ProtocolEntry> {
  const index = new Map<string, ProtocolEntry>();
  for (const entry of entries) index.set(entry.slug, entry);
  return index;
}

/** Slug order for ties: plain lexicographic, -1 / 0 / 1. */
function compareSlug(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function scoreBoard(snapshot: SnapshotDoc, model: ModelParams = MODEL): ScoredRow[] {
  const index = indexBySlug(snapshot.protocols);
  const picked = new Map<string, ProtocolEntry>();
  // The watchlist is the floor: every slug it names, even one the snapshot no longer
  // carries. Coverage is the gate's row and is never gambled on a missing record.
  for (const slug of snapshot.watchlist) {
    const found = index.get(slug);
    if (found !== undefined) picked.set(slug, found);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL, capped.
  // Never a replacement for a watchlist row: a picked protocol stays picked.
  const belowFloor = snapshot.protocols.filter((p) => !picked.has(p.slug) && canRank(p) && p.tvl_usd < snapshot.floor_usd);
  belowFloor.sort((a, b) => b.tvl_usd - a.tvl_usd || compareSlug(a.slug, b.slug));
  for (const entry of belowFloor.slice(0, EARLY_ROWS)) picked.set(entry.slug, entry);

  const scored: Array<{ entry: ProtocolEntry; value: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null }> = [];
  for (const entry of picked.values()) {
    const s = scoreOne(entry, snapshot.as_of, model);
    scored.push({ entry, value: s.value, growthPct: s.growthPct, growthMult: s.growthMult, maturityMult: s.maturityMult, age: s.age });
  }
  scored.sort((a, b) => b.value - a.value || compareSlug(a.entry.slug, b.entry.slug));
  return scored.map((s, i) => {
    const p = s.entry;
    const { slug, name, category, chains, tvl_usd, change_7d, mcap_usd, listed_at, gecko_id, symbol } = p;
    const { growthPct, growthMult, maturityMult, age, value } = s;
    const { base_multiple } = model;
    return {
      rank: i + 1, // ranks run 1..n in the sorted order
      slug,
      name,
      category,
      chains,
      tvl_usd,
      change_7d,
      mcap_usd,
      listed_at,
      gecko_id,
      symbol,
      token_status: 'pre-token', // the board only ranks pre-token rows
      age_days: age,
      implied_value_usd: value,
      model: {
        base_multiple,
        growth_pct: growthPct,
        growth_multiplier: to4dp(growthMult),
        maturity_multiplier: to4dp(maturityMult),
        age_days: age,
      },
      farm_steps: planFor(p, age).map(renderStep),
    };
  });
}

/** One step as a single string: its action, then its cost and time, within the gate's 20..600 characters. */
export function renderStep(step: PlanStep): string {
  const joined = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  if (joined.length > 600) return joined.slice(0, 596) + '...';
  if (joined.length < 20) return joined + " Hold the position and check the protocol's own page.";
  return joined;
}

/** The first chain a protocol names, or a neutral phrase. */
function mainChain(p: ProtocolEntry): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** TVL floors and the capital one farm position needs at each of them. */
const STAKE_TIERS: Array<[number, number]> = [
  [5_000_000_000, 250],
  [1_000_000_000, 150],
  [100_000_000, 100],
];

/** How much capital one farm position needs, from the protocol's own TVL. */
function stakeFor(p: ProtocolEntry): number {
  for (const [floor, stake] of STAKE_TIERS) {
    if (p.tvl_usd >= floor) return stake;
  }
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * One category's farm wording: the keywords that match it, the action the farmer
 * takes, and the weekly action that keeps the position counted. The table is read
 * top to bottom; the first match wins, so the order is the precedence.
 */
interface CategoryRule {
  keys: string[];
  action: (name: string, capital: number, chain: string) => string;
  weekly: (name: string) => string;
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    keys: ['lend', 'cdp', 'collateral'],
    action: (name, capital, chain) => 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.',
    weekly: () => 'Top up or repay a small part of the borrow once a week so the position shows fresh activity.',
  },
  {
    keys: ['dex', 'yield', 'leveraged farm'],
    action: (name, capital, chain) => 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.',
    weekly: (name) => 'Swap a small amount through ' + name + "'s main pool once a week.",
  },
  {
    keys: ['bridge'],
    action: (name, capital, chain) => 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.',
    weekly: (name) => 'Bridge a small amount through ' + name + ' once a week, in either direction.',
  },
  {
    keys: ['staking', 'restak'],
    action: (name, capital, chain) => "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.',
    weekly: () => 'Restake the rewards or add a small stake once a week.',
  },
  {
    keys: ['perpetual', 'derivative'],
    action: (name, capital, chain) => 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.',
    weekly: () => 'Open and close one small hedge a week.',
  },
  {
    keys: ['prediction'],
    action: (name, capital, chain) => 'Fund $' + capital + ' and place one market position on ' + name + '.',
    weekly: () => 'Place one small market position a week.',
  },
  {
    keys: ['curator', 'allocator'],
    action: (name, capital, chain) => 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.',
    weekly: (name) => 'Move a small amount between ' + name + ' vaults once a week.',
  },
  {
    keys: ['stable'],
    action: (name, capital, chain) => 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.',
    weekly: () => 'Mint or deposit a small amount of the stable asset once a week.',
  },
  {
    keys: ['rwa'],
    action: (name, capital, chain) => "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.',
    weekly: () => 'Mint or redeem a small amount of the yield asset once a week.',
  },
  {
    keys: ['insurance'],
    action: (name, capital, chain) => 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.',
    weekly: () => 'Check the cover policy once a week and renew it before it lapses.',
  },
];

/** The first rule whose keywords appear in the protocol's category, if any. */
function ruleFor(category: string | null): CategoryRule | undefined {
  const c = (category ?? '').toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keys.some((key) => c.includes(key))) return rule;
  }
  return undefined;
}

/** The category's one action, in the words a farmer can follow. */
function actionText(p: ProtocolEntry, capital: number, chain: string): string {
  const rule = ruleFor(p.category);
  if (rule !== undefined) return rule.action(p.name, capital, chain);
  return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
}

/** The weekly action that keeps a position counted, by what the protocol does. */
function weeklyText(p: ProtocolEntry): string {
  const rule = ruleFor(p.category);
  if (rule !== undefined) return rule.weekly(p.name);
  return 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.';
}

/** What one transaction costs on each chain the snapshot names, in plain dollars. */
const GAS_BY_CHAIN: Record<string, { tx: string; first: string }> = {
  ethereum: { tx: '$3 to $8', first: 'about $8' },
  solana: { tx: 'under $0.01', first: 'under $0.10' },
  bitcoin: { tx: '$1 to $3', first: 'about $3' },
  tron: { tx: '$0.50 to $1.50', first: 'about $2' },
  binance: { tx: '$0.10 to $0.30', first: 'about $0.50' },
  bnb: { tx: '$0.10 to $0.30', first: 'about $0.50' },
  bsc: { tx: '$0.10 to $0.30', first: 'about $0.50' },
  polygon: { tx: '$0.01 to $0.05', first: 'about $0.10' },
  avalanche: { tx: '$0.05 to $0.20', first: 'about $0.50' },
};

/** How much one transaction costs on the protocol's main chain. Any chain not named here is a low-fee L2 or L1. */
function gasForChain(chain: string): { tx: string; first: string } {
  return GAS_BY_CHAIN[chain.toLowerCase()] ?? { tx: '$0.05 to $0.50', first: 'about $1' };
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan
 * is derived from the protocol's own record (category, chains, TVL, age), never from
 * a hand-written list of names. Gas figures follow the protocol's main chain, so a
 * Solana farm costs cents and an Ethereum farm costs dollars, and the weekly action
 * fits what the protocol actually does.
 */
export function planFor(p: ProtocolEntry, age: number | null): PlanStep[] {
  const chain = mainChain(p);
  const gas = gasForChain(chain);
  const capital = stakeFor(p);
  const hold = holdFor(age);
  const action = actionText(p, capital, chain);
  const weekly = weeklyText(p);
  return [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: gas.first + ' of gas for the first transaction on ' + chain,
      time: '5 minutes',
    },
    {
      text: action,
      cost: '$' + capital + ' of capital and ' + gas.tx + ' of gas per transaction',
      time: '15 minutes to set up',
    },
    {
      text: weekly,
      cost: gas.tx + ' of gas a week',
      time: '10 minutes a week',
    },
    {
      text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.',
      cost: 'the $' + capital + ' stays in the position',
      time: hold + ' days',
    },
    {
      text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.",
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveSet(snapshot: SnapshotDoc): LiveEntry[] {
  const trading = snapshot.protocols.filter((p) => !hasNoToken(p) && p.category !== 'CEX');
  trading.sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd);
  return trading.slice(0, LIVE_ROWS).map((p) => {
    const { slug, name, category, chains, tvl_usd, mcap_usd, change_7d } = p;
    return { slug, name, category, chains, tvl_usd, mcap_usd, change_7d };
  });
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function pageRow(row: ScoredRow): PageRow {
  const { rank, slug, name, category, chains, tvl_usd, change_7d, mcap_usd, listed_at, age_days, implied_value_usd } = row;
  const { growth_multiplier, maturity_multiplier } = row.model;
  return {
    rank,
    slug,
    name,
    category,
    chains,
    tvl_usd,
    change_7d,
    mcap_usd,
    listed_at,
    age_days,
    implied_value_usd,
    growth_multiplier,
    maturity_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: SnapshotDoc, model: ModelParams = MODEL): { board: ScoredRow[]; radar: RadarPayload } {
  const board = scoreBoard(snapshot, model);
  const live = liveSet(snapshot);
  const { as_of, source, floor_usd, watchlist } = snapshot;
  let early = 0;
  for (const row of board) {
    if (!watchlist.includes(row.slug)) early += 1;
  }
  const radar: RadarPayload = {
    as_of,
    source,
    floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(pageRow),
    live,
  };
  return { board, radar };
}

/** Refuse a snapshot with `message`. */
function refuse(message: string): never {
  throw new SnapshotError(message);
}

/** A finite number from an unknown value, or null. */
function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A string from an unknown value, or null. */
function asText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): SnapshotDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    refuse('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) refuse('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) refuse('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') refuse('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) refuse('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) refuse('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) refuse('snapshot.json has no watchlist of slugs');
  const protocols: ProtocolEntry[] = [];
  for (let i = 0; i < o.protocols.length; i++) {
    const v = o.protocols[i];
    if (typeof v !== 'object' || v === null || Array.isArray(v)) refuse(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      refuse(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    protocols.push({
      slug: p.slug,
      name: p.name,
      category: asText(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: asFiniteNumber(p.change_7d),
      mcap_usd: asFiniteNumber(p.mcap_usd),
      listed_at: asText(p.listed_at),
      gecko_id: asText(p.gecko_id),
      symbol: asText(p.symbol),
    });
  }
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: ScoredRow[], snapshot: SnapshotDoc): string | null {
  const onBoard = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !onBoard.has(s));
  if (missing.length > 0) {
    return 'the board misses ' + missing.length + ' watchlist slug' + (missing.length === 1 ? '' : 's') + ': ' + missing.slice(0, 5).join(', ');
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return 'rank ' + (i + 1) + ' is ' + ranks[i];
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return 'row ' + (i + 1) + ' outranks row ' + i + ' on implied value';
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'all ' + board.length + ' rows share the same implied value $' + board[0]!.implied_value_usd + ': a board that ranks nothing by value is not a ranking';
  }
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return row.slug + ' has ' + row.farm_steps.length + ' farm steps';
    for (const step of row.farm_steps) {
      if (step.length < 20 || step.length > 600) return row.slug + ' has a farm step of ' + step.length + ' characters';
    }
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return row.slug + ' has implied value ' + row.implied_value_usd;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarPayload): string {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}
