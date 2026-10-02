// Build-time view models. Every number is read from /vectors or recomputed
// from it with lib/amp.ts. Where a vector file already states a result, the
// recomputation must match it exactly or the build fails.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  COIN_P_PPM, brierPpm2, meanPpm2, minDisputeBond, poolImpliedPpm, settleParimutuel, slashBonds, verdict,
  type Claim, type Outcome, type Side, type Verdict,
} from './amp'
import {
  VECTORS_DIR, loadArbitration, loadClose, loadForecast, loadIdentity, loadParimutuel,
  type ArbCase, type ParimutuelCase,
} from './vectors'

export class VectorMismatch extends Error {}
// Key-order-independent JSON for comparing results.
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'undefined'
}
function mustEqual(a: unknown, b: unknown, what: string) {
  if (canon(a) !== canon(b)) {
    throw new VectorMismatch(`${what}: computed ${JSON.stringify(a)} but vectors say ${JSON.stringify(b)}`)
  }
}

// ---------- scenarios (arbitration.json cases) ----------

export interface Scenario {
  name: string
  settled: boolean
  outcome: Outcome | null
  reason: string | null
  settle_ts: number
  scored: boolean
}

export function scenarios(): Scenario[] {
  return loadArbitration().cases.map((c) => ({
    name: c.name,
    settled: c.result.settled,
    outcome: c.result.outcome ?? null,
    reason: c.result.reason ?? c.result.why ?? null,
    settle_ts: c.settle_ts,
    scored: c.result.settled && (c.result.outcome === 'YES' || c.result.outcome === 'NO'),
  }))
}

// ---------- pool baseline (close.json) ----------

export interface PoolBaseline {
  yes_pool: string
  no_pool: string
  p_ppm: number
}

export function poolBaseline(): PoolBaseline {
  const c = loadClose()
  const yes = c.positions.filter((p) => p.side === 'YES').reduce((t, p) => t + BigInt(p.amount), 0n)
  const no = c.positions.filter((p) => p.side === 'NO').reduce((t, p) => t + BigInt(p.amount), 0n)
  mustEqual(yes.toString(), c.snapshot.yes_pool, 'close.json yes_pool')
  mustEqual(no.toString(), c.snapshot.no_pool, 'close.json no_pool')
  const p = poolImpliedPpm(yes, no)
  if (p === null) throw new VectorMismatch('close.json: empty pools, no pool baseline')
  return { yes_pool: c.snapshot.yes_pool, no_pool: c.snapshot.no_pool, p_ppm: p }
}

// ---------- reveal stage (forecast.json × scenario) ----------

export interface Envelope {
  index: number
  p_ppm: number
  commitment: string
  brier: string | null
  coin: Verdict | null
  crowd: Verdict | null
}

export interface RevealData {
  agent_id: string
  market_id: string
  coin_p_ppm: number
  pool: PoolBaseline
  scenarios: Scenario[]
  /** scenario name → envelopes; brier/verdicts are null when the scenario is not scored (§11). */
  byScenario: Record<string, { envelopes: Envelope[]; coin_brier: string | null; pool_brier: string | null }>
}

export function revealData(): RevealData {
  const f = loadForecast()
  const pool = poolBaseline()
  const sc = scenarios()
  // Every forecast case must reproduce the vector's stated Brier for both outcomes.
  for (const [i, c] of f.cases.entries()) {
    mustEqual(brierPpm2(c.p_ppm, 'YES').toString(), String(c.brier_ppm2_if_YES), `forecast.json cases[${i}] brier YES`)
    mustEqual(brierPpm2(c.p_ppm, 'NO').toString(), String(c.brier_ppm2_if_NO), `forecast.json cases[${i}] brier NO`)
  }
  const byScenario: RevealData['byScenario'] = {}
  for (const s of sc) {
    const out = s.scored ? (s.outcome as Side) : null
    const coinB = out ? brierPpm2(COIN_P_PPM, out) : null
    const poolB = out ? brierPpm2(pool.p_ppm, out) : null
    byScenario[s.name] = {
      coin_brier: coinB?.toString() ?? null,
      pool_brier: poolB?.toString() ?? null,
      envelopes: f.cases.map((c, i) => {
        const b = out ? brierPpm2(c.p_ppm, out) : null
        return {
          index: i + 1,
          p_ppm: c.p_ppm,
          commitment: c.commitment,
          brier: b?.toString() ?? null,
          coin: b !== null && coinB !== null ? verdict(b, coinB) : null,
          crowd: b !== null && poolB !== null ? verdict(b, poolB) : null,
        }
      }),
    }
  }
  return { agent_id: f.agent_id, market_id: f.market_id, coin_p_ppm: COIN_P_PPM, pool, scenarios: sc, byScenario }
}

export const DEFAULT_SCENARIO = 'dispute_flips_with_withheld_evidence'

// ---------- arena (arbitration.json) ----------

export interface ArenaStep {
  kind: 'RESOLVE' | 'DISPUTE'
  ts: number
  bond: string
  min_bond: string
  claimed: Outcome
  accepted: boolean
  round: number | null
  why: string | null
  claimant: string
  evidence_count: number
}

export interface ArenaModel {
  name: string
  question: string
  max_rounds: number
  base_bond: string
  dispute_window: number
  steps: ArenaStep[]
  rounds_used: number
  settled: boolean
  settle_ts: number
  outcome: Outcome | null
  reason: string | null
  bond_returns: string[] | null
  treasury_from_slash: string | null
}

function claimsOf(c: ArbCase): Claim[] {
  return c.events
    .filter((_, i) => c.result.log[i].accepted)
    .map((e) => ({ kind: e.kind, bond: e.bond, outcome: e.outcome, claimant: e.claimant }))
}

export function arenaModels(): ArenaModel[] {
  const a = loadArbitration()
  const B = BigInt(a.instance.resolver_bond)
  return a.cases.map((c) => {
    let disputes = 0
    const steps: ArenaStep[] = c.events.map((e, i) => {
      const log = c.result.log[i]
      const k = e.kind === 'DISPUTE' ? disputes + 1 : 0
      if (e.kind === 'DISPUTE' && log.accepted) disputes += 1
      return {
        kind: e.kind, ts: e.ts, bond: e.bond,
        min_bond: (e.kind === 'DISPUTE' ? minDisputeBond(B, k) : B).toString(),
        claimed: e.outcome, accepted: log.accepted, round: log.round ?? null, why: log.why ?? null,
        claimant: e.claimant, evidence_count: e.evidence.length,
      }
    })
    const r = c.result
    if (r.settled && r.outcome && r.reason) {
      const s = slashBonds(claimsOf(c), r.outcome, r.reason)
      mustEqual(s.bond_returns, r.bond_returns, `arbitration.json ${c.name} bond_returns`)
      mustEqual(s.treasury_from_slash, r.treasury_from_slash, `arbitration.json ${c.name} treasury_from_slash`)
      mustEqual(s.resolution_fee_recipient, r.resolution_fee_recipient, `arbitration.json ${c.name} resolution_fee_recipient`)
    }
    return {
      name: c.name, question: a.spec.question, max_rounds: a.instance.max_rounds, base_bond: a.instance.resolver_bond,
      dispute_window: a.instance.dispute_window, steps, rounds_used: disputes, settled: r.settled, settle_ts: c.settle_ts,
      outcome: r.outcome ?? null, reason: r.reason ?? r.why ?? null,
      bond_returns: r.bond_returns ?? null, treasury_from_slash: r.treasury_from_slash ?? null,
    }
  })
}

// ---------- parimutuel check ----------

export function checkParimutuel(): ParimutuelCase[] {
  const p = loadParimutuel()
  for (const c of p.cases) {
    mustEqual(settleParimutuel(c.positions, c.outcome, c.fee_bps, p.fee_split_bps), c.result, `parimutuel.json ${c.name}`)
  }
  return p.cases
}

// ---------- agents ----------

export interface AgentModel {
  agent_id: string
  alg: string | null
  kid: string | null
  roles: string[]
  positions: { side: Side; amount: string; payout_if_YES: string | null; payout_if_NO: string | null }[]
  forecast: { count: number; mean_brier_if_YES: string; mean_brier_if_NO: string } | null
}

interface MarketIdVectors { proposer_agent_id: string }

export function agentModels(): AgentModel[] {
  const ids = loadIdentity().identities
  const close = loadClose()
  const f = loadForecast()
  const mid = JSON.parse(readFileSync(path.join(VECTORS_DIR, 'market_id.json'), 'utf8')) as MarketIdVectors
  const pm = checkParimutuel()
  // parimutuel.json normal_with_dust / normal_no_wins use the same positions, in the
  // same order, as close.json. Only map payouts if that is still true.
  const sameAs = (c: ParimutuelCase | undefined) =>
    !!c && JSON.stringify(c.positions) === JSON.stringify(close.positions.map((p) => ({ side: p.side, amount: p.amount })))
  const yesCase = pm.find((c) => c.name === 'normal_with_dust')
  const noCase = pm.find((c) => c.name === 'normal_no_wins')
  const yesPay = sameAs(yesCase) ? yesCase!.result.payouts : null
  const noPay = sameAs(noCase) ? noCase!.result.payouts : null

  const all = new Set<string>([...ids.map((i) => i.agent_id), ...close.positions.map((p) => p.agent_id), f.agent_id, mid.proposer_agent_id])
  return [...all].sort().map((id) => {
    const ident = ids.find((i) => i.agent_id === id)
    const roles: string[] = []
    if (id === mid.proposer_agent_id) roles.push('proposer (market_id.json)')
    if (close.positions.some((p) => p.agent_id === id)) roles.push('staker (close.json)')
    if (id === f.agent_id) roles.push('forecaster (forecast.json)')
    const positions = close.positions
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.agent_id === id)
      .map(({ p, i }) => ({ side: p.side, amount: p.amount, payout_if_YES: yesPay?.[i] ?? null, payout_if_NO: noPay?.[i] ?? null }))
    const forecast = id === f.agent_id
      ? {
          count: f.cases.length,
          mean_brier_if_YES: meanPpm2(f.cases.map((c) => brierPpm2(c.p_ppm, 'YES'))).toString(),
          mean_brier_if_NO: meanPpm2(f.cases.map((c) => brierPpm2(c.p_ppm, 'NO'))).toString(),
        }
      : null
    return { agent_id: id, alg: ident?.alg ?? null, kid: ident?.kid ?? null, roles, positions, forecast }
  })
}
