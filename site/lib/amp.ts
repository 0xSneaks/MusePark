// AMP v0.3-draft integer math, ported from reference/python/amp.
// BigInt only; no floats. Pure functions, safe for client and server.

export type Outcome = 'YES' | 'NO' | 'INVALID'
export type Side = 'YES' | 'NO'
export type Verdict = 'BEAT' | 'TIED' | 'LOST'

export const PPM = 1_000_000

/** The coin-flip baseline: p = 0.5. */
export const COIN_P_PPM = 500_000

/** SPEC §11: brier_ppm2(p, outcome) = (p − (outcome == YES ? 10⁶ : 0))². Only YES/NO are scored. */
export function brierPpm2(pPpm: number, outcome: Side): bigint {
  if (!Number.isInteger(pPpm) || pPpm < 0 || pPpm > PPM) throw new RangeError('p_ppm must be an integer in [0, 1000000]')
  const o = outcome === 'YES' ? BigInt(PPM) : 0n
  const d = BigInt(pPpm) - o
  return d * d
}

/** Reference Reputation.mean_ppm2: floor(sum / count), 0 when empty. */
export function meanPpm2(scores: bigint[]): bigint {
  if (scores.length === 0) return 0n
  return scores.reduce((a, b) => a + b, 0n) / BigInt(scores.length)
}

/**
 * SITE-DEFINED, NOT NORMATIVE. The closing pool-implied probability of YES,
 * floor(yes × 10⁶ / (yes + no)). The spec mentions this quantity only in
 * OPEN_QUESTIONS #4 and does not define it. null when both pools are empty.
 */
export function poolImpliedPpm(yesPool: bigint, noPool: bigint): number | null {
  const total = yesPool + noPool
  if (total === 0n) return null
  return Number((yesPool * BigInt(PPM)) / total)
}

/** Lower Brier is better. */
export function verdict(score: bigint, baseline: bigint): Verdict {
  if (score < baseline) return 'BEAT'
  if (score > baseline) return 'LOST'
  return 'TIED'
}

export type FeeSplit = { proposer: number; resolver: number; settler: number; treasury: number }
const ROLES = ['proposer', 'resolver', 'settler'] as const

export interface SettleResult {
  case: string
  payouts: string[]
  fee_total: string
  fee_shares: Record<(typeof ROLES)[number], string>
  dust: string
  treasury_total: string
}

/** SPEC §9, mirroring reference/python/amp/parimutuel.py settle(). */
export function settleParimutuel(
  positions: { side: Side; amount: string }[],
  outcome: Outcome,
  feeBps: number,
  split: FeeSplit,
): SettleResult {
  const stakes = positions.map((p) => ({ side: p.side, a: BigInt(p.amount) }))
  const yes = stakes.filter((s) => s.side === 'YES').reduce((t, s) => t + s.a, 0n)
  const no = stakes.filter((s) => s.side === 'NO').reduce((t, s) => t + s.a, 0n)
  const zero = { proposer: '0', resolver: '0', settler: '0' }
  const refund = (c: string): SettleResult => ({
    case: c, payouts: stakes.map((s) => s.a.toString()), fee_total: '0', fee_shares: zero, dust: '0', treasury_total: '0',
  })
  if (outcome === 'INVALID') return refund('INVALID_REFUND')
  const [W, L] = outcome === 'YES' ? [yes, no] : [no, yes]
  if (W === 0n && L === 0n) return refund('EMPTY')
  if (W === 0n) return refund('NO_WINNERS_REFUND')
  if (L === 0n) return refund('ONE_SIDED_REFUND')
  const fee = (L * BigInt(feeBps)) / 10000n
  const distributable = L - fee
  let paidProfit = 0n
  const payouts = stakes.map((s) => {
    if (s.side !== outcome) return '0'
    const profit = (s.a * distributable) / W
    paidProfit += profit
    return (s.a + profit).toString()
  })
  const dust = distributable - paidProfit
  const shares = Object.fromEntries(ROLES.map((r) => [r, (fee * BigInt(split[r])) / 10000n])) as Record<(typeof ROLES)[number], bigint>
  const treasury = fee - ROLES.reduce((t, r) => t + shares[r], 0n) + dust
  return {
    case: 'NORMAL',
    payouts,
    fee_total: fee.toString(),
    fee_shares: { proposer: shares.proposer.toString(), resolver: shares.resolver.toString(), settler: shares.settler.toString() },
    dust: dust.toString(),
    treasury_total: treasury.toString(),
  }
}

export interface Claim {
  kind: 'RESOLVE' | 'DISPUTE'
  bond: string
  outcome: Outcome
  claimant: string
}

export interface SlashResult {
  bond_returns: string[]
  treasury_from_slash: string
  resolution_fee_recipient: string | null
}

/** SPEC §10.5, mirroring reference/python/amp/arbitration.py slash(). */
export function slashBonds(claims: Claim[], final: Outcome, reason: string): SlashResult {
  if (reason === 'ROUND_CAP' || reason === 'NO_RESOLUTION') {
    return { bond_returns: claims.map((c) => c.bond), treasury_from_slash: '0', resolution_fee_recipient: null }
  }
  const right = claims.filter((c) => c.outcome === final)
  const slashed = claims.filter((c) => c.outcome !== final).reduce((t, c) => t + BigInt(c.bond), 0n)
  const rewardPool = slashed / 2n
  const rightTotal = right.reduce((t, c) => t + BigInt(c.bond), 0n)
  let paid = 0n
  const bond_returns = claims.map((c) => {
    if (c.outcome !== final) return '0'
    const r = rightTotal > 0n ? (rewardPool * BigInt(c.bond)) / rightTotal : 0n
    paid += r
    return (BigInt(c.bond) + r).toString()
  })
  return {
    bond_returns,
    treasury_from_slash: (slashed - paid).toString(),
    resolution_fee_recipient: right.length > 0 && (final === 'YES' || final === 'NO') ? right[0].claimant : null,
  }
}

/** SPEC §10.3: the k-th dispute must post at least B × 2^k. */
export function minDisputeBond(base: bigint, k: number): bigint {
  return base * (1n << BigInt(k))
}

/** Exact decimal rendering of value / 10^scaleDigits, truncated to `decimals` places. */
export function formatScaled(value: bigint, scaleDigits: number, decimals: number): string {
  const neg = value < 0n
  const v = neg ? -value : value
  const scale = 10n ** BigInt(scaleDigits)
  const whole = v / scale
  const frac = (v % scale).toString().padStart(scaleDigits, '0').slice(0, decimals)
  return `${neg ? '−' : ''}${whole}${decimals > 0 ? '.' + frac : ''}`
}

/** Brier in ppm² as a 0–1 decimal (÷10¹²), 4 places, truncated. */
export function formatBrier(ppm2: bigint): string {
  return formatScaled(ppm2, 12, 4)
}

/** p_ppm as a percentage, up to 4 decimals, trailing zeros trimmed. */
export function formatPct(pPpm: number): string {
  const s = formatScaled(BigInt(pPpm), 4, 4).replace(/\.?0+$/, '')
  return `${s}%`
}

export function short(hex: string, n = 6): string {
  return `${hex.slice(0, n)}…${hex.slice(-4)}`
}
