import { describe, expect, it } from 'vitest'
import {
  COIN_P_PPM, brierPpm2, formatBrier, formatPct, meanPpm2, minDisputeBond, poolImpliedPpm,
  settleParimutuel, slashBonds, verdict,
} from '@/lib/amp'
import { loadArbitration, loadClose, loadForecast, loadParimutuel } from '@/lib/vectors'
import { agentModels, arenaModels, revealData, scenarios } from '@/lib/derive'

describe('SPEC §11 Brier, against vectors/forecast.json', () => {
  const f = loadForecast()
  it.each(f.cases.map((c, i) => [i, c] as const))('case %i', (_i, c) => {
    expect(brierPpm2(c.p_ppm, 'YES')).toBe(BigInt(c.brier_ppm2_if_YES))
    expect(brierPpm2(c.p_ppm, 'NO')).toBe(BigInt(c.brier_ppm2_if_NO))
  })
  it('coin baseline scores 0.25 either way', () => {
    expect(brierPpm2(COIN_P_PPM, 'YES')).toBe(250_000_000_000n)
    expect(brierPpm2(COIN_P_PPM, 'NO')).toBe(250_000_000_000n)
  })
  it('rejects out-of-range p', () => {
    expect(() => brierPpm2(1_000_001, 'YES')).toThrow()
    expect(() => brierPpm2(-1, 'YES')).toThrow()
    expect(() => brierPpm2(0.5, 'YES')).toThrow()
  })
  it('mean is floor division like the reference Reputation', () => {
    expect(meanPpm2([1n, 2n])).toBe(1n)
    expect(meanPpm2([])).toBe(0n)
  })
})

describe('SPEC §9 pari-mutuel, against vectors/parimutuel.json', () => {
  const p = loadParimutuel()
  it.each(p.cases.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    expect(settleParimutuel(c.positions, c.outcome, c.fee_bps, p.fee_split_bps)).toEqual(c.result)
  })
})

describe('SPEC §10.5 bonds, against vectors/arbitration.json', () => {
  const a = loadArbitration()
  const settled = a.cases.filter((c) => c.result.settled && c.result.outcome && c.result.reason)
  it('covers every settled case', () => expect(settled.length).toBe(5))
  it.each(settled.map((c) => [c.name, c] as const))('%s', (_n, c) => {
    const claims = c.events
      .filter((_, i) => c.result.log[i].accepted)
      .map((e) => ({ kind: e.kind, bond: e.bond, outcome: e.outcome, claimant: e.claimant }))
    const s = slashBonds(claims, c.result.outcome!, c.result.reason!)
    expect(s.bond_returns).toEqual(c.result.bond_returns)
    expect(s.treasury_from_slash).toBe(c.result.treasury_from_slash)
    expect(s.resolution_fee_recipient).toBe(c.result.resolution_fee_recipient)
  })
  it('settle_too_early is not settled', () => {
    const c = a.cases.find((x) => x.name === 'settle_too_early')!
    expect(c.result.settled).toBe(false)
    expect(c.result.why).toBe('TOO_EARLY')
  })
  it('dispute bond doubles per round (B × 2^k)', () => {
    expect(minDisputeBond(1_000_000n, 1)).toBe(2_000_000n)
    expect(minDisputeBond(1_000_000n, 4)).toBe(16_000_000n)
  })
})

describe('site-defined pool baseline (close.json)', () => {
  it('is floor(yes·1e6 / (yes+no)) of the closing snapshot', () => {
    const c = loadClose()
    const p = poolImpliedPpm(BigInt(c.snapshot.yes_pool), BigInt(c.snapshot.no_pool))
    // 5001000 × 1e6 / 8334333 = 600048.018…, floored
    expect(p).toBe(600048)
  })
  it('is null for empty pools', () => expect(poolImpliedPpm(0n, 0n)).toBeNull())
})

describe('verdicts and formatting', () => {
  it('lower Brier wins', () => {
    expect(verdict(1n, 2n)).toBe('BEAT')
    expect(verdict(2n, 2n)).toBe('TIED')
    expect(verdict(3n, 2n)).toBe('LOST')
  })
  it('formats exactly, truncating', () => {
    expect(formatBrier(72_900_000_000n)).toBe('0.0729')
    expect(formatBrier(1_000_000_000_000n)).toBe('1.0000')
    expect(formatPct(730_000)).toBe('73%')
    expect(formatPct(1)).toBe('0.0001%')
    expect(formatPct(0)).toBe('0%')
    expect(formatPct(1_000_000)).toBe('100%')
  })
})

describe('build-time view models agree with the vectors', () => {
  it('reveal: p=0.73 beats the coin and the crowd when YES', () => {
    const r = revealData()
    const env = r.byScenario.dispute_flips_with_withheld_evidence.envelopes.find((e) => e.p_ppm === 730_000)!
    expect(env.brier).toBe('72900000000')
    expect(env.coin).toBe('BEAT')
    expect(env.crowd).toBe('BEAT')
  })
  it('reveal: INVALID scenarios are not scored (§11)', () => {
    const r = revealData()
    expect(r.byScenario.no_resolution.envelopes.every((e) => e.brier === null)).toBe(true)
    expect(r.byScenario.settle_too_early.envelopes.every((e) => e.brier === null)).toBe(true)
  })
  it('arena and agents build without mismatches', () => {
    expect(arenaModels()).toHaveLength(6)
    expect(scenarios()).toHaveLength(6)
    const agents = agentModels()
    expect(agents.length).toBe(3)
    expect(agents.find((a) => a.forecast)?.agent_id).toBe(loadForecast().agent_id)
  })
})
