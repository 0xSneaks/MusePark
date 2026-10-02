// Typed, validating loader for the repo's conformance vectors (../vectors).
// Runs only at build time (server components) and in tests. It never invents
// data: every value the site shows comes from these files or is computed from
// them with lib/amp.ts.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

export type Outcome = 'YES' | 'NO' | 'INVALID'
export type Side = 'YES' | 'NO'

export interface ForecastCase {
  p_ppm: number
  commitment: string
  brier_ppm2_if_YES: number
  brier_ppm2_if_NO: number
}
export interface ForecastVectors {
  market_id: string
  agent_id: string
  salt: string
  cases: ForecastCase[]
}

export interface ClosePosition {
  agent_id: string
  side: Side
  amount: string
}
export interface CloseVectors {
  market_id: string
  positions: ClosePosition[]
  leaves: string[]
  empty_root: string
  snapshot: { yes_pool: string; no_pool: string; position_count: number; positions_root: string }
}

export type Roles = 'proposer' | 'resolver' | 'settler'
export interface ParimutuelCase {
  name: string
  fee_bps: number
  outcome: Outcome
  positions: { side: Side; amount: string }[]
  result: {
    case: string
    dust: string
    fee_shares: Record<Roles, string>
    fee_total: string
    payouts: string[]
    treasury_total: string
  }
}
export interface ParimutuelVectors {
  fee_split_bps: Record<Roles | 'treasury', number>
  cases: ParimutuelCase[]
}

export interface ArbEvent {
  kind: 'RESOLVE' | 'DISPUTE'
  ts: number
  bond: string
  claimant: string
  outcome: Outcome
  evidence: unknown[]
}
export interface ArbLog {
  accepted: boolean
  kind: 'RESOLVE' | 'DISPUTE'
  outcome?: Outcome
  round?: number
  why?: string
}
export interface ArbResult {
  settled: boolean
  why?: string
  log: ArbLog[]
  outcome?: Outcome
  reason?: string
  bond_returns?: string[]
  treasury_from_slash?: string
  resolution_fee_recipient?: string | null
}
export interface ArbCase {
  name: string
  settle_ts: number
  events: ArbEvent[]
  result: ArbResult
}
export interface Instance {
  rail: string
  collateral: string
  creation_fee: string
  fee_bps: number
  fee_split_bps: Record<Roles | 'treasury', number>
  min_stake: string
  resolver_bond: string
  resolve_window: number
  dispute_window: number
  max_rounds: number
  reveal_window: number
}
export interface ArbitrationVectors {
  spec: { question: string; close_ts: number; oracle: Record<string, unknown> }
  instance: Instance
  cases: ArbCase[]
}

export interface Identity {
  agent_id: string
  alg: 'ed25519' | 'secp256k1'
  kid: string
}
export interface IdentityVectors {
  identities: Identity[]
}

export const VECTORS_DIR = path.resolve(process.cwd(), '..', 'vectors')

class VectorShapeError extends Error {}

function fail(file: string, msg: string): never {
  throw new VectorShapeError(`${file}: ${msg}`)
}

const HEX32 = /^[0-9a-f]{64}$/
const UINT = /^(0|[1-9][0-9]*)$/

function obj(file: string, v: unknown, where: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(file, `${where} is not an object`)
  return v as Record<string, unknown>
}
function arr(file: string, v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) fail(file, `${where} is not an array`)
  return v
}
function hex32(file: string, v: unknown, where: string): string {
  if (typeof v !== 'string' || !HEX32.test(v)) fail(file, `${where} is not 32-byte hex`)
  return v
}
function uintStr(file: string, v: unknown, where: string): string {
  if (typeof v !== 'string' || !UINT.test(v)) fail(file, `${where} is not a decimal integer string`)
  return v
}
function int(file: string, v: unknown, where: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) fail(file, `${where} is not a safe non-negative integer`)
  return v
}
function oneOf<T extends string>(file: string, v: unknown, allowed: readonly T[], where: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) fail(file, `${where} must be one of ${allowed.join(', ')}`)
  return v as T
}

function read(file: string): unknown {
  return JSON.parse(readFileSync(path.join(VECTORS_DIR, file), 'utf8'))
}

export function loadForecast(): ForecastVectors {
  const f = 'forecast.json'
  const d = obj(f, read(f), 'root')
  return {
    market_id: hex32(f, d.market_id, 'market_id'),
    agent_id: hex32(f, d.agent_id, 'agent_id'),
    salt: hex32(f, d.salt, 'salt'),
    cases: arr(f, d.cases, 'cases').map((c, i) => {
      const o = obj(f, c, `cases[${i}]`)
      const p = int(f, o.p_ppm, `cases[${i}].p_ppm`)
      if (p > 1_000_000) fail(f, `cases[${i}].p_ppm out of range`)
      return {
        p_ppm: p,
        commitment: hex32(f, o.commitment, `cases[${i}].commitment`),
        brier_ppm2_if_YES: int(f, o.brier_ppm2_if_YES, `cases[${i}].brier_ppm2_if_YES`),
        brier_ppm2_if_NO: int(f, o.brier_ppm2_if_NO, `cases[${i}].brier_ppm2_if_NO`),
      }
    }),
  }
}

export function loadClose(): CloseVectors {
  const f = 'close.json'
  const d = obj(f, read(f), 'root')
  const s = obj(f, d.snapshot, 'snapshot')
  return {
    market_id: hex32(f, d.market_id, 'market_id'),
    empty_root: hex32(f, d.empty_root, 'empty_root'),
    leaves: arr(f, d.leaves, 'leaves').map((l, i) => hex32(f, l, `leaves[${i}]`)),
    positions: arr(f, d.positions, 'positions').map((p, i) => {
      const o = obj(f, p, `positions[${i}]`)
      return {
        agent_id: hex32(f, o.agent_id, `positions[${i}].agent_id`),
        side: oneOf(f, o.side, ['YES', 'NO'] as const, `positions[${i}].side`),
        amount: uintStr(f, o.amount, `positions[${i}].amount`),
      }
    }),
    snapshot: {
      yes_pool: uintStr(f, s.yes_pool, 'snapshot.yes_pool'),
      no_pool: uintStr(f, s.no_pool, 'snapshot.no_pool'),
      position_count: int(f, s.position_count, 'snapshot.position_count'),
      positions_root: hex32(f, s.positions_root, 'snapshot.positions_root'),
    },
  }
}

function split(file: string, v: unknown, where: string): Record<Roles | 'treasury', number> {
  const o = obj(file, v, where)
  return {
    proposer: int(file, o.proposer, `${where}.proposer`),
    resolver: int(file, o.resolver, `${where}.resolver`),
    settler: int(file, o.settler, `${where}.settler`),
    treasury: int(file, o.treasury, `${where}.treasury`),
  }
}

export function loadParimutuel(): ParimutuelVectors {
  const f = 'parimutuel.json'
  const d = obj(f, read(f), 'root')
  return {
    fee_split_bps: split(f, d.fee_split_bps, 'fee_split_bps'),
    cases: arr(f, d.cases, 'cases').map((c, i) => {
      const o = obj(f, c, `cases[${i}]`)
      const r = obj(f, o.result, `cases[${i}].result`)
      const fs = obj(f, r.fee_shares, `cases[${i}].result.fee_shares`)
      return {
        name: String(o.name),
        fee_bps: int(f, o.fee_bps, `cases[${i}].fee_bps`),
        outcome: oneOf(f, o.outcome, ['YES', 'NO', 'INVALID'] as const, `cases[${i}].outcome`),
        positions: arr(f, o.positions, `cases[${i}].positions`).map((p, j) => {
          const po = obj(f, p, `cases[${i}].positions[${j}]`)
          return {
            side: oneOf(f, po.side, ['YES', 'NO'] as const, 'side'),
            amount: uintStr(f, po.amount, 'amount'),
          }
        }),
        result: {
          case: String(r.case),
          dust: uintStr(f, r.dust, 'dust'),
          fee_total: uintStr(f, r.fee_total, 'fee_total'),
          treasury_total: uintStr(f, r.treasury_total, 'treasury_total'),
          payouts: arr(f, r.payouts, 'payouts').map((x) => uintStr(f, x, 'payout')),
          fee_shares: {
            proposer: uintStr(f, fs.proposer, 'fee_shares.proposer'),
            resolver: uintStr(f, fs.resolver, 'fee_shares.resolver'),
            settler: uintStr(f, fs.settler, 'fee_shares.settler'),
          },
        },
      }
    }),
  }
}

export function loadArbitration(): ArbitrationVectors {
  const f = 'arbitration.json'
  const d = obj(f, read(f), 'root')
  const spec = obj(f, d.spec, 'spec')
  const ins = obj(f, d.instance, 'instance')
  const kinds = ['RESOLVE', 'DISPUTE'] as const
  const outcomes = ['YES', 'NO', 'INVALID'] as const
  return {
    spec: {
      question: String(spec.question),
      close_ts: int(f, spec.close_ts, 'spec.close_ts'),
      oracle: obj(f, spec.oracle, 'spec.oracle'),
    },
    instance: {
      rail: String(ins.rail),
      collateral: String(ins.collateral),
      creation_fee: uintStr(f, ins.creation_fee, 'instance.creation_fee'),
      fee_bps: int(f, ins.fee_bps, 'instance.fee_bps'),
      fee_split_bps: split(f, ins.fee_split_bps, 'instance.fee_split_bps'),
      min_stake: uintStr(f, ins.min_stake, 'instance.min_stake'),
      resolver_bond: uintStr(f, ins.resolver_bond, 'instance.resolver_bond'),
      resolve_window: int(f, ins.resolve_window, 'instance.resolve_window'),
      dispute_window: int(f, ins.dispute_window, 'instance.dispute_window'),
      max_rounds: int(f, ins.max_rounds, 'instance.max_rounds'),
      reveal_window: int(f, ins.reveal_window, 'instance.reveal_window'),
    },
    cases: arr(f, d.cases, 'cases').map((c, i) => {
      const o = obj(f, c, `cases[${i}]`)
      const r = obj(f, o.result, `cases[${i}].result`)
      const events = arr(f, o.events, `cases[${i}].events`).map((e, j) => {
        const eo = obj(f, e, `cases[${i}].events[${j}]`)
        return {
          kind: oneOf(f, eo.kind, kinds, 'kind'),
          ts: int(f, eo.ts, 'ts'),
          bond: uintStr(f, eo.bond, 'bond'),
          claimant: hex32(f, eo.claimant, 'claimant'),
          outcome: oneOf(f, eo.outcome, outcomes, 'outcome'),
          evidence: arr(f, eo.evidence, 'evidence'),
        }
      })
      const log = arr(f, r.log, `cases[${i}].result.log`).map((l) => {
        const lo = obj(f, l, 'log entry')
        return {
          accepted: lo.accepted === true,
          kind: oneOf(f, lo.kind, kinds, 'log.kind'),
          outcome: lo.outcome === undefined ? undefined : oneOf(f, lo.outcome, outcomes, 'log.outcome'),
          round: lo.round === undefined ? undefined : int(f, lo.round, 'log.round'),
          why: lo.why === undefined ? undefined : String(lo.why),
        }
      })
      if (log.length !== events.length) fail(f, `cases[${i}]: log and events differ in length`)
      const result: ArbResult = { settled: r.settled === true, log }
      if (r.why !== undefined) result.why = String(r.why)
      if (r.outcome !== undefined) result.outcome = oneOf(f, r.outcome, outcomes, 'result.outcome')
      if (r.reason !== undefined) result.reason = String(r.reason)
      if (r.bond_returns !== undefined) result.bond_returns = arr(f, r.bond_returns, 'bond_returns').map((x) => uintStr(f, x, 'bond_return'))
      if (r.treasury_from_slash !== undefined) result.treasury_from_slash = uintStr(f, r.treasury_from_slash, 'treasury_from_slash')
      if (r.resolution_fee_recipient !== undefined) {
        result.resolution_fee_recipient = r.resolution_fee_recipient === null ? null : hex32(f, r.resolution_fee_recipient, 'resolution_fee_recipient')
      }
      return { name: String(o.name), settle_ts: int(f, o.settle_ts, `cases[${i}].settle_ts`), events, result }
    }),
  }
}

export function loadIdentity(): IdentityVectors {
  const f = 'identity.json'
  const d = obj(f, read(f), 'root')
  return {
    identities: arr(f, d.identities, 'identities').map((x, i) => {
      const o = obj(f, x, `identities[${i}]`)
      // test_private_key is deliberately not read: the site never handles keys.
      return {
        agent_id: hex32(f, o.agent_id, `identities[${i}].agent_id`),
        alg: oneOf(f, o.alg, ['ed25519', 'secp256k1'] as const, `identities[${i}].alg`),
        kid: hex32(f, o.kid, `identities[${i}].kid`),
      }
    }),
  }
}

/** SHA-256 of each vector file's raw bytes, for the /join page. */
export function vectorFileDigests(): { file: string; sha256: string }[] {
  const files = [
    'arbitration.json', 'close.json', 'envelopes.json', 'forecast.json', 'identity.json',
    'jcs.json', 'market_id.json', 'oracle.json', 'parimutuel.json',
  ]
  return files.map((file) => ({
    file,
    sha256: createHash('sha256').update(readFileSync(path.join(VECTORS_DIR, file))).digest('hex'),
  }))
}
