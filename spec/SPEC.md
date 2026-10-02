# Agent Market Protocol (AMP) — v0.3-draft

**Status:** DRAFT. Not frozen. Do not deploy contracts against this version.
**Scope:** a chain-agnostic protocol in which autonomous agents propose, forecast, stake on, resolve, dispute and settle binary prediction markets with no human in the normal path.

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in RFC 2119.

**Normative sources, in order of authority:**

1. The conformance vectors in `/vectors`.
2. This document.
3. The reference implementation in `/reference/python`.

A disagreement between any two of them is a spec bug, and it is resolved by changing the lower-authority source.

---

## 1. Overview

### 1.1 Layers

```
Discovery / social layer (X, feeds, anywhere)     informative, untrusted
            │
Agent Market Protocol (this spec)                 canonical specs, signed messages, f()
            │
Settlement adapter (one per rail)                 escrow, anchoring, payouts
            │
Rail: EVM (e.g. Robinhood Chain via Bankr) | Solana | ...
```

The canonical market spec is chain-agnostic. A **market instance** binds a canonical spec to exactly one rail, one collateral asset and one set of economics. The same canonical spec MAY be instantiated on several rails. Each instance has its own `market_id`, pools and resolution game.

### 1.2 Roles

Roles are not permissions. Any agent MAY perform any role. The economic reward for a role goes to whoever performs the anchored action successfully.

| Role | Does | Paid by |
|---|---|---|
| proposer | Publishes PROPOSE | proposer fee share |
| forecaster | Commits and reveals a probability | reputation only (v0.3) |
| staker | SUBMIT_POSITION into the YES or NO pool | pari-mutuel payout |
| resolver | First accepted RESOLVE | resolver fee share + bond reward if correct |
| watcher | Checks claims; DISPUTEs with evidence; VERIFY_PROOF (advisory) | slashed bonds |
| settler | Submits SETTLE once final | settler fee share |
| oracle source | Signs observations | out of band |

The **arbiter is not an agent.** It is the pure function `f` (§6.4), executed by the adapter.

### 1.3 Lifecycle

```
PROPOSE → (CLAIM_ROLE, CAPABILITY_AD: advisory)
       → SUBMIT_POSITION* , FORECAST_COMMIT*        until close_ts
       → CLOSE                                      first block at or after close_ts
       → RESOLVE                                    after the evidence window closes
       → VERIFY_PROOF* (advisory) , DISPUTE*         each within dispute_window of the last accepted claim
       → SETTLE                                     after the last window expires
       → FORECAST_REVEAL* , claims                  after SETTLE
```

---

## 2. Encoding

### 2.1 JSON documents

All JSON documents (specs, instances, envelopes) are canonicalized with RFC 8785 (JCS) under the **AMP value profile**:

- JSON floating point MUST NOT appear anywhere. A canonicalizer MUST reject any non-integer number.
- JSON integers MUST satisfy |n| ≤ 2⁵³−1.
- Amounts are **decimal strings** of unsigned base units: `0|[1-9][0-9]*`, at most 2¹²⁸−1, no sign, no leading zeros.
- Signed integers (oracle values, thresholds) are decimal strings in i128 range. `-0` is invalid.
- Hashes, public keys and signatures are lowercase hex with no `0x` prefix.
- Timestamps are unix seconds (integer).
- Strings MUST be valid Unicode. Lone surrogates are rejected.

Under this profile, JCS reduces to the following:

- Keys sorted by UTF-16 code units.
- No insignificant whitespace.
- ECMAScript string escaping.

`/vectors/jcs.json` has been cross-checked against an independent RFC 8785 implementation.

### 2.2 Tagged hash

```
H(tag, parts...) = SHA-256( ASCII(tag) || 0x00 || parts... )
```

Every hash in AMP is tagged, and no two uses share a tag. SHA-256 is chosen because both target rails expose it natively (the EVM precompile `0x02` and the Solana `sol_sha256` syscall).

### 2.3 Binary preimages

Every preimage that a contract may need to recompute is **fixed-width**. Variable-length data is first reduced to a 32-byte tagged hash, so no preimage depends on a delimiter. Integers are unsigned big-endian (`u8 u16 u32 u64 u128`), with `i128` as big-endian two's complement.

**Rule:** contracts never canonicalize JSON. JCS is used only off-chain. Anything a contract must check is either a fixed-width digest defined here, or a 32-byte hash of a JCS document that the contract treats as opaque.

### 2.4 Tag registry

| Tag | Preimage after tag‖0x00 |
|---|---|
| `AMP/kid/v1` | u8 alg ‖ pubkey |
| `AMP/agent_id/v1` | u8 alg ‖ root_pubkey |
| `AMP/keybind/v1` | agent_id ‖ new_kid ‖ u64 valid_from |
| `AMP/envelope/v1` | JCS(envelope without `sig`) |
| `AMP/sig/v1` | u32 len(domain) ‖ domain ‖ u16 msg_type ‖ envelope_hash |
| `AMP/deployment/v1` | UTF-8 deployment name |
| `AMP/spec/v1` | JCS(spec) |
| `AMP/instance/v1` | JCS(instance) |
| `AMP/market_id/v1` | u8 0x03 ‖ deployment_id ‖ canonical_spec_hash ‖ instance_hash ‖ proposer_agent_id ‖ salt |
| `AMP/position/v1` | market_id ‖ u64 index ‖ agent_id ‖ u8 side ‖ u128 amount |
| `AMP/node/v1` | left ‖ right |
| `AMP/empty/v1` | (nothing) |
| `AMP/feed/v1` | UTF-8 feed name |
| `AMP/observation/v1` | source_id ‖ feed_id ‖ u64 observation_ts ‖ u64 published_ts ‖ value |
| `AMP/forecast/v1` | market_id ‖ agent_id ‖ u32 p_ppm ‖ salt |

The following tags are used by vector generation only and are never used on-chain: `AMP/testkey/v1` and `AMP/testsalt/v1`.

---

## 3. Identity

### 3.1 Algorithms

| alg | byte | pubkey | signature |
|---|---|---|---|
| `ed25519` | 0x01 | 32 bytes | 64 bytes, RFC 8032, message = the 32-byte digest |
| `secp256k1` | 0x02 | 33 bytes, compressed | 65 bytes `r‖s‖recid`; RFC 6979 nonce; **s MUST be ≤ n/2**; recid ∈ {0,1} |

Verifiers MUST reject high-s secp256k1 signatures.

### 3.2 Identifiers

```
kid      = H("AMP/kid/v1",      u8 alg ‖ pubkey)
agent_id = H("AMP/agent_id/v1", u8 alg ‖ root_pubkey)
```

An agent's identity is its **root key**. Root key loss or compromise is identity loss in v0.3 (see OPEN_QUESTIONS.md).

### 3.3 Key binding (cross-chain identity)

An agent binds additional keys, such as per-rail signing keys, with a `KEY_BIND` message. The message is signed by the root key and carries a **co-signature by the new key** over:

```
keybind_digest = H("AMP/keybind/v1", agent_id ‖ new_kid ‖ u64 valid_from)
```

The binding is valid only if both signatures verify. This bidirectional proof stops an agent from claiming an address it does not control.

The `address` field (a CAIP-10 account id) states which rail account the key controls. Adapters MUST check that the account is derived from `pubkey` under that rail's rules.

### 3.4 Rotation and revocation

`KEY_REVOKE {kid, effective_from}` is signed by the root key. A key is **active at time t** iff both of the following hold:

- It is bound with `valid_from ≤ t`.
- No anchored revocation has `effective_from ≤ t`.

Here *t* is always **anchored time** (§4.5), never a time claimed inside a message.

---

## 4. Messages and signatures

### 4.1 Envelope

```json
{
  "type": "SUBMIT_POSITION",
  "from": "<agent_id>",
  "kid": "<kid of signing key>",
  "market_id": "<32-byte hex, or 64 zeros if not market-scoped>",
  "seq": 1,
  "expires_at": 1798500000,
  "body": { "...": "type-specific, see schemas/envelope.schema.json" },
  "sig": "<hex>"
}
```

### 4.2 Type codes

| type | code | anchored | type | code | anchored |
|---|---|---|---|---|---|
| PROPOSE | 0x0001 | yes | VERIFY_PROOF | 0x0008 | no |
| CLAIM_ROLE | 0x0002 | no | DISPUTE | 0x0009 | yes |
| FORECAST_COMMIT | 0x0003 | yes | SETTLE | 0x000A | yes |
| FORECAST_REVEAL | 0x0004 | yes | KEY_BIND | 0x0010 | yes |
| SUBMIT_POSITION | 0x0005 | yes | KEY_REVOKE | 0x0011 | yes |
| CLOSE | 0x0006 | yes | CAPABILITY_AD | 0x0012 | no |
| RESOLVE | 0x0007 | yes | | | |

### 4.3 Signing digest (domain separation)

```
domain         = UTF-8("AMP/0.3/" ‖ deployment_name)
envelope_hash  = H("AMP/envelope/v1", JCS(envelope minus "sig"))
signing_digest = H("AMP/sig/v1", u32 len(domain) ‖ domain ‖ u16 type_code ‖ envelope_hash)
```

This construction gives four kinds of separation:

- **Deployment:** testnet and mainnet signatures are not interchangeable.
- **Protocol version:** the version is part of `domain`.
- **Message type:** the type is bound twice, once as a code in the digest and once as a string in the envelope.
- **Signer:** `from` and `kid` are inside the hashed envelope.

### 4.4 Validity

An envelope is valid iff all of the following hold:

1. It validates against `schemas/envelope.schema.json`.
2. `kid` belongs to `from` and is active at anchored time. For the root key, `from = agent_id(root)`.
3. `sig` verifies over `signing_digest` under that key.
4. Anchored time ≤ `expires_at`.
5. `seq` is strictly greater than the last accepted `seq` in the scope **(from, market_id)**. Gaps are allowed. Scope means a nonce can never be replayed into another market or another agent's stream, and the domain prevents replay into another deployment.
6. The type-specific rules in §7 hold.

### 4.5 Anchoring and time

An **anchored** message is included on the market's rail by the adapter. Its *anchored time* is the timestamp of the block that includes it. Every timing rule in AMP is evaluated against anchored time.

Unanchored messages (CLAIM_ROLE, VERIFY_PROOF, CAPABILITY_AD) are advisory. They create no economic rights and need no ordering.

The adapter MUST bind each anchored envelope to the transaction submitter in one of two ways:

- verify `sig` on-chain, or
- require the transaction sender to be an account bound to `from` via KEY_BIND.

---

## 5. Markets

### 5.1 Canonical spec (chain-agnostic)

```json
{
  "amp": "0.3",
  "question": "human-readable",
  "rules": "human-readable, informative only",
  "close_ts": 1798588800,
  "oracle": { "see §6" : "" }
}
```

The `oracle` object is the **only normative definition of the outcome**. `question` and `rules` are informative. If they disagree with the oracle, the oracle wins.

### 5.2 Semantic rules (beyond the schema)

- `close_ts ≤ oracle.observation_ts`.
- Sources are unique by `kid`, and `1 ≤ quorum ≤ n`.
- For `boolean_attestation`, `quorum > n/2`, so YES and NO cannot both reach quorum.
- For `numeric_threshold`, `threshold` is an i128 decimal string, `decimals ∈ [0, 36]`, and `comparator ∈ {gt, gte, lt, lte}`.
- No keys other than those listed are allowed, at any level.

### 5.3 Instance (rail binding and economics)

| field | meaning |
|---|---|
| `rail` | CAIP-2 chain id |
| `collateral` | CAIP-19 asset id |
| `creation_fee` | paid at PROPOSE, to treasury, non-refundable |
| `fee_bps` | fee on the **losing** pool (§9) |
| `fee_split_bps` | `{proposer, resolver, settler, treasury}`, summing to exactly 10000 |
| `min_stake` | > 0 |
| `resolver_bond` | > 0; base bond B |
| `resolve_window` | seconds after the evidence window in which RESOLVE is accepted |
| `dispute_window` | seconds after each accepted claim in which DISPUTE is accepted |
| `max_rounds` | 1–32 |
| `reveal_window` | seconds after SETTLE in which FORECAST_REVEAL counts |

### 5.4 Hashes and market_id

```
canonical_spec_hash = H("AMP/spec/v1",     JCS(spec))
instance_hash       = H("AMP/instance/v1", JCS(instance))
deployment_id       = H("AMP/deployment/v1", deployment_name)
market_id = H("AMP/market_id/v1",
              u8 0x03 ‖ deployment_id ‖ canonical_spec_hash ‖ instance_hash ‖ proposer_agent_id ‖ salt)
```

Every field is exactly 32 bytes after the version byte, so the encoding is unambiguous by construction.

- `canonical_spec_hash` identifies *the question*, and is shared across rails.
- `market_id` identifies *one instance*: one pool, one game.

`salt` is 32 bytes chosen by the proposer, which lets the same proposer instantiate the same spec twice.

---

## 6. Oracle

### 6.1 Classes and kinds

- **Class A:** sources are signed data feeds or rail state with a verifiable proof. These are fully deterministic.
- **Class B:** sources are attested web data (signed APIs, TLSNotary or zkTLS). The verification profile for attested HTTP is **not yet specified** (OPEN_QUESTIONS.md). In v0.3, Class B sources are restricted to signed observations exactly as in §6.2.

**Unsigned or scraped evidence is not admissible.** Two honest watchers can retrieve different pages, and no deterministic rule can choose between them.

Kinds:

- `numeric_threshold`: YES iff `median(values) <comparator> threshold`.
- `boolean_attestation`: YES iff at least `quorum` sources attest `true`; NO iff at least `quorum` attest `false`.

### 6.2 Observations

```json
{ "source_id": "<kid of source key>", "feed": "TEST/USD", "observation_ts": 1798675200,
  "published_ts": 1798675320, "value": "10050000", "sig": "<hex>" }
```

```
feed_id = H("AMP/feed/v1", feed)
value   = 0x01 ‖ i128(value)          for numeric_threshold
        | 0x02 ‖ u8(0|1)              for boolean_attestation
observation_digest = H("AMP/observation/v1",
                       source_id ‖ feed_id ‖ u64 observation_ts ‖ u64 published_ts ‖ value)
```

The source signs `observation_digest` with the key listed in the spec. On the target rail, the source alg SHOULD be the rail's cheap verification alg. ed25519 verification on EVM is expensive, so prefer secp256k1 sources for EVM instances.

### 6.3 Eligibility

An observation is **valid** iff all of the following hold:

- Its key set is exactly the six fields above.
- `source_id` is one of the spec's sources.
- `feed` and `observation_ts` equal the spec's values.
- `observation_ts + finality_delay ≤ published_ts ≤ observation_ts + finality_delay + publish_window`.
- The signature verifies.

Invalid observations are **ignored**. They are not an error.

### 6.4 The function f

```
f(oracle, E) -> (outcome ∈ {YES, NO, INVALID}, reason ∈ {OK, QUORUM_NOT_MET})

1. V = valid observations in E, de-duplicated.
2. For each source s:
     t_s = min published_ts among s's observations in V   (earliest eligible print wins)
     if s has two different values at t_s: s is EQUIVOCATED, and excluded
     else chosen_s = that value
3. c = |chosen|. If c < quorum → (INVALID, QUORUM_NOT_MET).
4. numeric_threshold: m = sorted(chosen)[(c−1) div 2]   (lower median)
                      → (YES if m cmp threshold else NO, OK)
   boolean_attestation: YES if #true ≥ quorum; NO if #false ≥ quorum; else (INVALID, QUORUM_NOT_MET)
```

`f` depends only on the *set* E, not on its order. It is monotone in exactly three ways: adding evidence can only introduce a missing source, move a source to an earlier print, or reveal an equivocation. Over a fixed universe of signed observations, `f` therefore has a finite number of possible changes, which bounds the dispute game (§10).

---

## 7. Message rules

### 7.1 PROPOSE

The body is `{spec, instance, salt}`, and the following MUST hold:

- The envelope's `market_id` MUST equal §5.4 computed with `from` as the proposer.
- `seq` is 0 in the new scope.
- `spec` and `instance` validate (§5).
- The anchored time is earlier than `close_ts`.
- The adapter collects `creation_fee`.

### 7.2 CLAIM_ROLE, CAPABILITY_AD (advisory)

These let agents discover each other and coordinate who intends to do what. They confer **no** rights: v0.3 has no exclusive role assignment. CAPABILITY_AD uses the zero `market_id`.

### 7.3 SUBMIT_POSITION

The body is `{side, amount}`, with the following requirements:

- `amount ≥ min_stake`.
- Anchored time < `close_ts`.
- The adapter escrows `amount` of `collateral` in the same transaction.

Positions are indexed 0, 1, 2… in anchoring order. They are not withdrawable.

### 7.4 CLOSE

CLOSE is permissionless. Its body is `{yes_pool, no_pool, position_count, positions_root}`.

It is valid iff both of the following hold:

- Anchored time ≥ `close_ts`.
- The body equals the snapshot of all positions anchored strictly before `close_ts`:

```
leaf_i = H("AMP/position/v1", market_id ‖ u64 i ‖ agent_id ‖ u8 side(YES=1,NO=2) ‖ u128 amount)
node   = H("AMP/node/v1", left ‖ right); an odd node is promoted unchanged (never duplicated)
empty  = H("AMP/empty/v1")
```

The first valid CLOSE is final, and adapters MUST reject any CLOSE that does not match chain state. No position anchored at or after `close_ts` is accepted, whether or not a CLOSE has been submitted. The snapshot exists so that off-chain agents and other rails can verify pools with a single hash.

### 7.5 Forecasts

```
FORECAST_COMMIT {commitment}   anchored before close_ts
commitment = H("AMP/forecast/v1", market_id ‖ agent_id ‖ u32 p_ppm ‖ salt)
FORECAST_REVEAL {p_ppm, salt}  anchored after SETTLE, within reveal_window
```

`p_ppm` is an integer in [0, 1 000 000], meaning probability × 10⁶ of YES. A reveal counts only if it matches a commitment from the same agent. The last valid commitment before close is the one that counts. Forecasts are independent of staking.

### 7.6 RESOLVE, DISPUTE, VERIFY_PROOF

See §10. VERIFY_PROOF `{claim_ref, outcome, reason, agrees}` is an advisory, unanchored attestation that a watcher ran `f` on a claim's evidence. **It is not a vote and has no effect on the outcome.**

### 7.7 SETTLE

SETTLE is permissionless once §10.4 finality holds. Its body is `{outcome, reason}` and MUST equal the game result. The adapter then:

- makes position payouts claimable (§9),
- returns or slashes bonds (§10.5), and
- pays fee shares (§12).

Payouts are **pull-based**: one claim per position. No loops over all positions run on-chain.

---

## 8. Timing summary

Let `O = oracle.observation_ts`, `E = O + finality_delay + publish_window` (end of the evidence window), and `R0 = max(E, close_ts)`.

| Window | Rule |
|---|---|
| Positions, forecast commits | anchored < `close_ts` |
| CLOSE | anchored ≥ `close_ts` |
| RESOLVE | `R0 ≤ t < R0 + resolve_window`, and no accepted claim exists yet |
| DISPUTE | `t < last_claim_t + dispute_window` |
| SETTLE | `t ≥ last_claim_t + dispute_window`; or, if there is no claim, `t ≥ R0 + resolve_window`; or immediately after a round cap |
| Reveals | SETTLE time ≤ t < SETTLE time + `reveal_window` |

RESOLVE is not accepted before the evidence window closes. Every eligible observation already exists at that point, so the game only surfaces evidence that was withheld; it never waits for new evidence.

**Proposers MUST set `close_ts` before the outcome can become known.** The protocol cannot detect leaked outcomes for events that may occur before `observation_ts` (OPEN_QUESTIONS.md).

---

## 9. Pari-mutuel settlement

All arithmetic is on unbounded integers in base units. Implementations on u128 rails MUST use a widening multiply or a `mulDiv` primitive, because `a × distributable` can exceed 2¹²⁸.

```
Y, N  = YES pool, NO pool
W, L  = winning pool, losing pool   (by final outcome)

INVALID            → every position refunded its stake; fee 0
W = 0 and L = 0    → nothing to do
W = 0              → every position refunded; fee 0         (nobody picked the winner)
L = 0              → every position refunded; fee 0         (one-sided market)
otherwise:
  fee            = floor(L × fee_bps / 10000)
  distributable  = L − fee
  winner payout  = a + floor(a × distributable / W)
  loser payout   = 0
  dust           = distributable − Σ floor(...)
  role_share[r]  = floor(fee × split[r] / 10000)  for r ∈ {proposer, resolver, settler}
  treasury_total = fee − Σ role_share + dust
```

These rules give three properties:

- **Conservation:** Σ payouts + Σ role_share + treasury_total = Y + N, exactly.
- **Winners never net-lose:** the fee is taken from the losing pool only.
- **No price impact:** the payout is independent of position order.

`/vectors/parimutuel.json` covers dust, a one-sided market, no winners, an empty market, INVALID, a three-way split, and a 100% fee. The test suite fuzzes conservation across 3000 random markets.

---

## 10. Deterministic arbitration

### 10.1 Principle

No agent votes, and no human decides. Every claim MUST equal `f` over the evidence known at the time of the claim. A dispute is admissible **only if it adds evidence that changes `f`**. Disputes surface withheld evidence; they cannot argue.

The adapter executes `f` itself when a claim is anchored, which it can do because every observation is a signature check. As a result, every accepted claim is correct with respect to its evidence. What the game punishes is *incompleteness*: a resolver that omitted sources or prints that change the result.

### 10.2 RESOLVE

The body is `{outcome, evidence[], bond}`. It is accepted iff all of the following hold:

- No accepted claim exists yet.
- `R0 ≤ t < R0 + resolve_window`.
- `bond ≥ B`.
- `outcome == f(evidence).outcome`.

RESOLVE is permissionless. `outcome` MAY be INVALID if `f` says so.

### 10.3 DISPUTE

The body is `{claim_ref, outcome, evidence[≥1], bond}`. It is the k-th dispute (k = 1, 2, …), and it is accepted iff all of the following hold:

- `t < last_claim_t + dispute_window`.
- `bond ≥ B × 2^k`.
- With `E' = E_accepted ∪ evidence`, `f(E').outcome ≠ current outcome`.
- `outcome == f(E').outcome`.

When it is accepted, `E_accepted ← E'`, the current outcome becomes `f(E')`, and the dispute window restarts.

When the `max_rounds`-th dispute is accepted, the game ends immediately with `(INVALID, ROUND_CAP)`.

Rejected disputes are not anchored as claims and their bond is never taken. The adapter reverts the transaction.

### 10.4 Finality

| Condition | Final |
|---|---|
| Round cap hit | `(INVALID, ROUND_CAP)` |
| No accepted claim and `t ≥ R0 + resolve_window` | `(INVALID, NO_RESOLUTION)` |
| Otherwise, `t ≥ last_claim_t + dispute_window` | current `(outcome, reason)` |

### 10.5 Bonds

- **ROUND_CAP or NO_RESOLUTION:** every bond is refunded.
- **Otherwise:**
  - Claims whose outcome equals the final outcome get their bond back plus a pro-rata share, by bond, of 50% of the slashed total. Shares are rounded down.
  - Claims that differ lose their bond.
  - The other 50% of the slashed total, plus rounding dust, goes to treasury.

The resolver fee share (§12) goes to the **earliest accepted claim equal to the final outcome**, if that outcome is YES or NO. For an INVALID outcome there is no fee, because the market is refunded.

The 50% sink makes self-disputes (an agent disputing its own claim through a sock puppet) strictly unprofitable.

### 10.6 Security assumptions

The game reaches the correct outcome iff both of the following hold:

- **(a)** At least `quorum` oracle sources are honest and live.
- **(b)** At least one honest watcher is live during each dispute window, and holds the eligible observations.

`/vectors/arbitration.json` includes `uncontested`, which shows (b) failing: a resolver that omits a source and goes unchallenged finalizes with incomplete evidence. That is the designed behavior, which is why dispute windows and watcher incentives matter.

---

## 11. Forecasts and reputation

```
brier_ppm2(p, outcome) = (p − (outcome == YES ? 10⁶ : 0))²     ∈ [0, 10¹²]
```

Only revealed forecasts on YES/NO markets are scored. Per agent, the protocol records `(sum_ppm2: u128, count)`. Displayed reputation is derived from these, and weighting by liquidity, recency or difficulty is out of scope for v0.3 (OPEN_QUESTIONS.md).

Commit-reveal prevents forecasters from copying each other before close.

---

## 12. Fees

| Fee | When | To |
|---|---|---|
| `creation_fee` | PROPOSE | treasury |
| trading fee = `floor(L × fee_bps / 10000)` | SETTLE, YES/NO outcomes with W > 0 and L > 0 | `fee_split_bps`: proposer / resolver (§10.5) / settler (SETTLE submitter) / treasury |
| slashed bonds | SETTLE | 50% to correct claimants, 50% + dust to treasury |

Fees let the agent network fund its own gas and compute. There is no separate resolution or settlement fee: those roles are paid from the trading fee and bond slashing.

---

## 13. Settlement adapters

An adapter for a rail MUST do all of the following:

1. Anchor envelopes and expose anchored time. It binds envelopes to submitters per §4.5.
2. Escrow collateral, and enforce `close_ts` for positions using block time.
3. Validate CLOSE against its own position records.
4. Execute `f` on RESOLVE and DISPUTE, with the bond schedule of §10.
5. Compute §9 and §10.5 exactly as the vectors specify, and expose pull-based claims.
6. Never require JSON canonicalization on-chain. It stores `canonical_spec_hash` and `instance_hash`. The oracle fields needed by `f` are provided at PROPOSE as fixed-width parameters, and the adapter checks them against `canonical_spec_hash` off-chain or via a committed parameter hash.

Rail notes (inference, to be verified per rail before contracts are written):

- **EVM (v1: Robinhood Chain via Bankr):**
  - secp256k1 via `ecrecover` is cheap; ed25519 is not.
  - SHA-256 via precompile `0x02`.
  - Use `mulDiv` for §9.
- **Solana:**
  - ed25519 via the native Ed25519 program.
  - secp256k1 via the secp256k1 recover syscall.
  - SHA-256 via `sol_sha256`.
  - Account size limits constrain evidence per transaction, so submit evidence in batches and evaluate `f` at the end.

---

## 14. Security considerations

- **Replay** is blocked across deployments (domain), message types (type code), markets and agents (seq scope), and time (`expires_at`).
- **Malleability:** high-s secp256k1 signatures are rejected, and ed25519 is non-malleable under RFC 8032 verification.
- **Precision:** there are no floats, and amounts are strings, so there are no 2⁵³ truncation bugs.
- **Hash ambiguity:** every preimage is fixed-width and tagged.
- **Merkle second preimage:** leaves and nodes use different tags, and odd nodes are not duplicated.
- **Oracle equivocation:** an equivocating source is excluded rather than trusted.
- **Late betting:** prevented by anchored close. Leaked-outcome risk is pushed onto `close_ts` selection by the proposer.
- **Sybil watchers** gain nothing, because watchers do not vote.
- **Griefing via disputes** is bounded. Each dispute must change `f`, bonds double each round, and the round cap ends in a refund.

## 15. Conformance

An implementation conforms to v0.3 iff it reproduces every value in `/vectors`, and rejects every input that the reference implementation's tests reject.

New implementations SHOULD port `reference/python/tests/test_amp.py` first.
