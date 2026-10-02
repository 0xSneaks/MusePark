/** UTC timestamp from vector seconds, e.g. 2026-12-31 01:00:00 UTC. */
export function utc(ts: number): string {
  return new Date(ts * 1000).toISOString().replace('T', ' ').replace('.000Z', ' UTC')
}

/** Group a base-unit integer string with thin spaces for readability. */
export function units(s: string): string {
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

export const SCENARIO_BLURB: Record<string, string> = {
  uncontested: 'A resolver omits a source and nobody challenges it. The incomplete answer stands (SPEC §10.6).',
  dispute_flips_with_withheld_evidence: 'A watcher brings the withheld print. The outcome flips and the resolver is slashed.',
  dispute_rejected_no_change: 'A dispute that does not change f is rejected. No bond is taken.',
  resolve_too_early_then_valid: 'A resolve before the evidence window closes bounces; the next one lands.',
  no_resolution: 'Nobody resolves in time. The market ends INVALID and everyone is refunded.',
  settle_too_early: 'SETTLE one second before finality is rejected (TOO_EARLY).',
}
