# OQ #2 design review — on-chain oracle parameters (`oracle_params_hash`)

**Status:** DRAFT FOR REVIEW. Nothing in this document is normative yet. No repo file has been
modified. On approval, the changes in §K are implemented in one PR; until it merges, the
implementation hold on PROPOSE / `market_id` / RESOLVE intake / DISPUTE intake remains.

**Scope:** resolve OPEN_QUESTIONS.md item 2 (BLOCKS-FREEZE) under the implementation-side
constraints supplied by Bankr. Design only — `f`, payout math, bond math, arbitration semantics,
the Bankr adapter and all existing vectors are untouched by this document.

**Non-goals:** OQ #1 (Class B verification profile), OQ #10 (freeze hash), gas benchmarking,
instance-parameter typing (flagged in §I-R9 as a follow-up).

**Decision principle (per Bankr input):** deterministic cross-implementation behavior first;
representation cost second. No gas figure in this document is claimed as measured.

---

## 0. Bankr constraint traceability

| Bankr input | Where resolved |
|---|---|
| 1. exact normative source representation | §C, §D, §E |
| 1a. raw bytes vs digest | §C.4 |
| 1b. secp256k1 address derivation | §C.5 (adapter-internal, specified) |
| 1c. ed25519 handling | §C.6 |
| 1d. duplicates, sort rule, max count | §D |
| 1e. direct membership vs source-set commitment | §C.7 |
| 2. static params committed at PROPOSE; RESOLVE/DISPUTE carry evidence only | §F |
| 2f. market_id commits `oracle_params_hash` directly or via spec hash; no cycle | §F.1–F.2 |
| 3. evidence calldata griefing caps | §G |
| 4. Class B extensibility without Class A ID churn | §H |

---

## A. Recommended fixed-width oracle parameter binary layout

One byte string `P`, hashed under one tag. All integers unsigned big-endian except `threshold`
(i128 two's-complement big-endian), per SPEC §2.3. Constant-stride; no length fields; no
delimiters; the only variable parts are (i) the kind union, selected by byte 0, and (ii) the
source array, sized by the `source_count` field, and (iii) the profile extension, sized by the
`profile` field's registry entry (empty for the only profile defined in v0.3).

| offset | size | field | encoding |
|---|---|---|---|
| 0 | 1 | `kind` | 0x01 `numeric_threshold`, 0x02 `boolean_attestation` |
| 1 | 1 | `class` | 0x01 A, 0x02 B |
| 2 | 4 | `profile` | u32; 0x00000000 = AMP-signed observations (only value in v0.3) |
| 6 | 32 | `feed_id` | `H("AMP/feed/v1", UTF-8(feed))` |
| 38 | 8 | `observation_ts` | u64 |
| 46 | 8 | `finality_delay` | u64 |
| 54 | 8 | `publish_window` | u64 |
| 62 | 2 | `source_count` | u16, `n`; 1 ≤ n ≤ 32 |
| 64 | 2 | `quorum` | u16, `q`; 1 ≤ q ≤ n |
| 66 | 18 | *kind union* — present iff `kind = 0x01` | `u8 comparator` (0x01 gt, 0x02 gte, 0x03 lt, 0x04 lte) ‖ `u8 decimals` (0..36) ‖ `i128 threshold` (16 B) |
| 66 (boolean) / 84 (numeric) | 34 × n | source entries | see §C; strictly ascending bytewise (§D) |
| end | var | *profile extension* | empty for profile 0x00000000; defined per future profile (§H) |

Total size, profile 0: numeric `84 + 34n` (118..1172 B for n = 1..32); boolean
`66 + 34n` (100..1154 B).

Rationale for field order: discriminators first (`kind`, `class`, `profile`), then common
scalars, then counts, then the kind union, then arrays, then the open-ended profile extension
last so profiles can never move an existing field.

## B. Exact field widths and endianness

- Every integer is **big-endian** (§2.3): `u8`, `u16`, `u32`, `u64`, `i128` (two's complement).
- `threshold` is the binary i128 image of the spec's canonical decimal string (SPEC §2.1);
  binary 0 encodes `"0"`; `"-0"` is rejected at string parse (existing `signed_int` rule), so
  no binary ambiguity exists.
- `decimals` is committed even though `f` never reads it: it makes `P` a complete typed mirror
  of every normative field of the oracle object, so the PROPOSE-time consistency check (§F.3)
  covers the whole oracle object with no "which fields are committed" exception list.
- `source_count`/`quorum` are u16 (not u8) for uniform headroom; the bound n ≤ 32 is a value
  rule (§D), not a width artifact.
- `profile` is u32 so the header never changes width when Class B profiles are registered (§H).
- `feed` is committed only as `feed_id` (32 B). The raw feed string is variable-length and is
  reduced to its tagged hash per the standing §2.3 rule; the string itself remains recoverable
  only from the JSON spec, and is bounded at 128 UTF-8 bytes (new rule, §G.2).

## C. Exact source commitment representation

**C.1 Source identifier type.** The canonical identity of a source is the pair
(`algorithm_id`, `pubkey_bytes`) exactly as in SPEC §3.1 — this is what the commitment carries.
`kid = H("AMP/kid/v1", u8 alg ‖ pubkey)` remains the *derived* identifier used by observations
(`source_id`) and by membership checks.

**C.2 Algorithm identifier.** `u8`, reusing the §3.1 registry: 0x01 ed25519, 0x02 secp256k1.
New algorithms extend that registry; extension never renumbers existing values.

**C.3 Key slot.** Each source is a constant-stride 34-byte entry:

```
entry = u8 alg ‖ key_slot[33]
ed25519:   key_slot = pubkey[32] ‖ 0x00            (33rd byte is a fixed zero pad)
secp256k1: key_slot = compressed_pubkey[33]        (SEC1 compressed, 0x02/0x03 prefix)
```

Constant stride was chosen over the variable `alg ‖ pubkey` form so that parsing, duplicate
detection and canonical sorting are branch-free byte operations on 34-byte words (rejected
alternative §I-R5). A nonzero pad byte is invalid.

**C.4 Raw bytes or digest.** Per source: **raw identity bytes** (alg + key material). The
source *set*: **raw concatenation of the sorted entries** — no per-source digest and no
source-set Merkle root (§I-R3). `feed`: digest (`feed_id`), because variable-length. The whole
blob `P`: committed as one digest, `oracle_params_hash`. This is exactly the §2.3 division:
fixed-width data enters preimages raw; variable-length data enters as a 32-byte tagged hash.

**C.5 secp256k1 EVM address derivation (adapter-internal, specified for Bankr).** The
protocol commitment contains no addresses — keccak is not an AMP hash and addresses are
rail-specific. The EVM adapter derives, once at PROPOSE and stores alongside the key:

```
(X, Y)  = decompress(compressed_pubkey)
evm_address = keccak256(0x04 ‖ X ‖ Y)[12:32]
verification: ecrecover(observation_digest, v = recid + 27, r, s) == evm_address
```

`observation_digest` is the SHA-256 §6.2 digest; low-s and recid ∈ {0,1} are already §3.1
normative. This derivation is specified here so all EVM adapters derive the same stored value;
it never enters any AMP preimage.

**C.6 ed25519 handling.** Committed as the 32-byte raw key plus zero pad. Verification per
§3.1 (64-byte RFC 8032 signature over the 32-byte digest). Ed25519 is cheap on Solana, not on
EVM. New normative adapter rule (§K, SPEC §13): **an adapter MUST reject at PROPOSE any market
whose source algorithms it cannot verify**; it MUST NOT accept such a market and later treat
those sources' observations as invalid — that silently degrades quorum and turns a proposer
mistake into an INVALID-resolution trap. Bankr v1 policy (accept ed25519 or not) is the
adapter's choice under this rule.

**C.7 Membership: direct, not via a secondary commitment.** At PROPOSE the adapter computes
`kid_i = H("AMP/kid/v1", alg_i ‖ pubkey_i)` for each committed entry (n ≤ 32 SHA-256 calls,
once) and stores the kid table plus key material. At RESOLVE/DISPUTE, each evidence item's
`source_id` is checked by linear scan of the stored kid table (≤ 32 word comparisons), then its
signature is verified against the stored key. `oracle_params_hash` itself is the only
source-set commitment; no Merkle membership proofs anywhere. At n ≤ 32 proofs only add calldata
and code paths (§I-R3).

## D. Ordering / canonicalization / count rules

1. **Canonical source sort:** entries are ordered **ascending bytewise over the 34-byte
   entry** (memcmp order; equivalently: sort by `alg`, then key material, fixed-width). The
   JSON `sources` array order is *not* normative; `derive()` (§F.3) sorts. The committed list is
   therefore a function of the source *set*, matching `f`'s set semantics.
2. **Duplicate rejection:** the encoded sequence MUST be *strictly* ascending; equal entries
   are rejected structurally. This subsumes duplicate (`alg`, `pubkey`) pairs. SPEC §5.2's
   "unique by kid" rule is retained in `validate_spec`; under SHA-256 collision-freedom the two
   rules coincide, and bytewise uniqueness is the mechanically enforced one.
3. **Maximum source count:** `MAX_SOURCES = 32`. Protocol-level, deterministically justified
   (not gas-derived): it bounds the params blob at 1,172 B, the stored kid table at 32 words,
   per-claim verification work at ≤ 2n ≤ 64 signature verifications (§G.3), and keeps the
   boolean quorum rule (`2q > n`) comfortably representable. Raising it later is a **breaking**
   change (it widens nothing in the layout but changes a validity rule; see §J) and should wait
   for measured cost data.
4. **All other canonicalization** (hex lowercase, decimal strings, i128 ranges, u53 integer
   bounds) is inherited from §2.1; the binary layer adds no new text formatting.

## E. `oracle_params_hash` preimage definition

```
oracle_params_hash = H("AMP/oracle_params/v1", P)

P = u8 kind ‖ u8 class ‖ u32 profile
  ‖ feed_id[32]
  ‖ u64 observation_ts ‖ u64 finality_delay ‖ u64 publish_window
  ‖ u16 source_count ‖ u16 quorum
  ‖ (u8 comparator ‖ u8 decimals ‖ i128 threshold)     -- iff kind = 0x01
  ‖ entry[34] × source_count                            -- strictly ascending (§D)
  ‖ profile_extension                                   -- iff profile ≠ 0; empty in v0.3
```

New tag `AMP/oracle_params/v1`, registered in §2.4. Validation rules, all executable on-chain
from `P` alone (the adapter runs them before hashing):

- `kind ∈ {0x01, 0x02}`; `class ∈ {0x01, 0x02}`; `profile = 0x00000000` (v0.3: registry empty).
- `1 ≤ source_count ≤ 32`; `1 ≤ quorum ≤ source_count`; if `kind = 0x02`, `2·quorum > source_count`.
- If `kind = 0x01`: `comparator ∈ {0x01..0x04}`, `decimals ≤ 36`; `threshold` is any i128.
- Each entry: `alg ∈ {0x01, 0x02}`; bytes beyond the alg's key width inside the 33-byte slot
  MUST be 0x00; sequence strictly ascending.
- `feed_id` is a hash and cannot be validated on-chain; it is validated transitively by §F.3.

**Worked example (informative, becomes a vector on merge):** for the oracle object committed in
`/vectors/market_id.json` (numeric_threshold, class A, feed `TEST/USD`, 3 ed25519 sources,
quorum 2, `gte`, decimals 2, threshold 10000000):

```
P (186 bytes) = 0101 00000000
  910fbf81ed37cb7c02931d40e7e83874e9ce82b9f7395d96743e19a13c9850cb
  000000006b359b00 000000000000003c 0000000000000e10 0003 0002
  02 02 00000000000000000000000000989680
  011551b51dbf245445a7e1e5b1fddeffe9e778deae18e53f6fb4c7d251670078ae00
  013bf2bd203ac3cf1ff51f995fba1f0508e06a0430eb00767130a2c7328c52f63d00
  01a67f722b4fe61be85328c53f296f94613b810a309fa61f5ca0fe53f3c0d992af00

oracle_params_hash = fa4b6763c85547e018b5f6b5601b691763df5e33c64e801fbd7f791377184969
```

Note the sorted entry order differs from the fixture's JSON array order — an implementation
that serialized in JSON order would produce a different hash. That is precisely the divergence
class §D.1 exists to eliminate. Computed with the unmodified reference code; script in the PR
description, values re-derived by `gen_vectors.py` on merge.

## F. How `oracle_params_hash` enters `market_id` / PROPOSE

**F.1 Decision.** `market_id` commits `oracle_params_hash` **directly**, as a sixth preimage
component. `canonical_spec_hash` keeps its definition `H("AMP/spec/v1", JCS(spec))` and does
**not** commit `oracle_params_hash`. New layout, new tag (layout versions are tag-versioned;
the leading byte stays the protocol version):

```
market_id = H("AMP/market_id/v2",
              u8 0x03 ‖            -- protocol version (amp "0.3"); layout version is the tag
              deployment_id ‖       -- 32
              canonical_spec_hash ‖ -- 32
              oracle_params_hash ‖  -- 32   (NEW)
              instance_hash ‖       -- 32
              proposer_agent_id ‖   -- 32
              salt)                 -- 32
```

Worked example (informative): with the fixture above, the new
`market_id = 270971cd4f531b23ff8434b9f17ed445bab5d7a6c73a968188e0fa3354bd0440`
(old: `bb566170…`). `canonical_spec_hash`, `instance_hash`, `deployment_id` are unchanged.

**F.2 No circularity.** The commitment DAG is a tree:

```
oracle JSON ──► P ──► oracle_params_hash ─┐
spec JSON ────► JCS(spec) ─► canonical_spec_hash ─┤
deployment name ─► deployment_id ─┤            market_id
instance JSON ─► instance_hash ─┤
proposer key, salt ──────────────┘
```

`P` depends only on the oracle object; `canonical_spec_hash` does not depend on `P` or on
`oracle_params_hash`; nothing in any preimage depends on `market_id`. No cycles.

**F.3 Why direct rather than folding into `canonical_spec_hash`** (Bankr's explicit either/or):

the alternative — redefining `canonical_spec_hash` over typed fields
(`oracle_params_hash ‖ H(question) ‖ H(rules) ‖ u64 close_ts`) so that `market_id` commits it
transitively — has the *same* breaking radius (every `market_id` changes either way), so the
choice is architectural, and direct wins: (i) `canonical_spec_hash` stays the hash of the
readable document — the spec's "the document is the artifact" story and the JCS layer stay
intact; (ii) `oracle_params_hash` is a standalone first-class digest: markets with identical
oracle configuration are comparable/indexable by it, and Class B profiles attach to it without
touching the document format; (iii) one fewer representation of question/rules to keep in
sync. The cost is that the oracle object is committed twice (once inside JCS, once typed) —
harmless, and their consistency is enforced exactly once, at anchor (F.4).

**F.4 PROPOSE flow (static params committed once).**

1. Envelope PROPOSE body stays `{spec, instance, salt}` — **unchanged schema**; the envelope's
   `market_id` field must equal the v2 value above.
2. Adapter anchor-time validation (off-chain, before anything is submitted): schema-validate
   spec/instance; compute `P = derive(spec.oracle)` — encode per §E, canonicalizing source
   order per §D.1; recompute `canonical_spec_hash`, `instance_hash`, `oracle_params_hash`,
   `market_id`; verify envelope signature and `market_id` equality. A conforming adapter never
   anchors a proposal whose `derive(spec.oracle)` and committed params disagree.
3. The adapter's anchoring transaction carries the typed static set — `{deployment_id,
   canonical_spec_hash, oracle_params_hash, instance_hash, proposer_agent_id, salt, P}` (≤ ~1.2
   KB) plus the typed instance economics and `close_ts` (u64) it must store anyway. The
   contract: validates `P` (§E rules), recomputes `oracle_params_hash` from `P` via the SHA-256
   precompile, recomputes `market_id` from the six components, requires equality, and stores
   the parameter set plus the derived kid table (§C.7) once. The contract never sees JSON.
4. **RESOLVE and DISPUTE thereafter carry only** `{outcome, evidence[], bond}` / `{claim_ref,
   outcome, evidence[≥1], bond}` — exactly today's bodies, no static config. For profile 0 no
   evidence-specific metadata beyond the observation fields exists: every input `f` needs
   either lives in the stored parameter set or in the evidence item itself (`source_id`, feed,
   timestamps, value, signature). Future profiles may add per-item artifacts inside their own
   evidence item schema (§H); the envelope body shape does not change.

**Binding theorem (informal).** `market_id` commits both `canonical_spec_hash` and
`oracle_params_hash`; conforming anchors require `P = derive(spec.oracle)` for the spec whose
JCS hash is the committed `canonical_spec_hash`; therefore every anchored market's on-chain
resolution configuration is the typed image of its published spec, and any party can re-verify
this from public data (envelope + chain). A market created by a *non-conforming* anchorer is
objectively detectable (the two committed hashes won't correspond) and its `market_id` still
unambiguously determines which parameters resolve it — the ones in `P`. Mismatch cannot change
resolution semantics; it can only make a market's description misleading, and it is
never anchorable through a conforming adapter.

## G. Evidence byte/count caps (griefing)

**G.1 Caps (protocol-level, deterministic; NOT gas-derived):**

| Constant | Value | Applies to |
|---|---|---|
| `MAX_EVIDENCE_ITEMS_PER_CLAIM` | `2 × source_count` (≤ 64 absolute via `MAX_SOURCES`) | each RESOLVE / DISPUTE `evidence` array (submitted items, pre-deduplication) |
| `MAX_EVIDENCE_ITEM_BYTES` | 640 | each evidence item, measured on its JCS bytes in the envelope |
| derived worst case | 640 × 2n ≤ **40,960 B** | per anchored claim message (product of the two; no third knob) |

No independent aggregate cap: the item cap × count cap is exactly the deterministic aggregate
bound, and a third constant could only contradict them.

**G.2 Sufficiency of `2n` (why the count cap loses nothing).** In §6.4, per source only the
observations at the *minimum* `published_ts` within a message matter (earliest-eligible-wins),
and at that timestamp at most two distinct values matter (two distinct signed values already
equate the source; further values add nothing). Any single-message transition of `f` is
therefore expressible with ≤ 2 items per source, so `2n` items suffice to express every
admissible claim and every admissible dispute. The bound is tight against the protocol's own
semantics, not a budget guess.

**G.3 Why 640 per item.** The schema-maximal profile-0 item is ≈ 455 JCS bytes: fixed syntax +
keys ≈ 73, two timestamps ≤ 20 digits, `source_id` 64 hex, `sig` ≤ 130 hex (secp256k1 65 B),
`value` ≤ 40 chars, `feed` ≤ 128 UTF-8 bytes (new normative feed bound, see §K). 640 rounds up
with headroom so profile 0 never needs the constant re-touched. The feed bound closes the only
otherwise-unbounded field.

**G.4 Scope of application.** Per **anchored message** (each RESOLVE / DISPUTE), not aggregate
across the game: total accepted evidence is structurally bounded by
`(1 + max_rounds) × 2n ≤ 33 × 64` items via bond doubling and the round cap. `VERIFY_PROOF` is
unanchored and advisory — caps are not normative for it (relayers MAY apply local limits).

**G.5 Class A vs Class B.** The frame caps above are **class-agnostic and shared**: in v0.3
Class B is restricted to signed observations (profile 0), so there is exactly one evidence
format and one cap. When OQ #1 registers Class B profiles, each profile MUST define
subtype-specific caps **strictly tighter than or equal to** the frame (e.g.
`MAX_PROOF_BYTES ≤ 640`, `MAX_PROOFS_PER_CLAIM ≤ 2n`), read from the committed `profile` field
so the adapter knows the applicable sub-cap without any market re-creation. No Class B cap is
sized today (§I-R10).

**G.6 Rejection behavior.** Caps are **structural envelope validation, checked before any
signature verification and before `f`**, in this order: decode → schema/shape → item byte cap →
item count cap → signature verification → seq/window/bond rules → `f`. An oversized message is
*malformed* — never anchored, never a rejected claim, no bond effects (a fortiori §10.3's
"rejected disputes take no bond"). On-chain the adapter reverts with distinct reasons
(informative EVM custom errors: `EvidenceItemBytesExceeded`, `EvidenceItemCountExceeded`) so
griefing attempts are diagnosable. Cheap length checks precede expensive verification, so both
the anchor node (pre-inclusion, where the DoS cost would otherwise fall) and the chain see
bounded work.

**G.7 Gas tuning.** Explicitly deferred: caps are protocol determinism constants, not
benchmarks. Robinhood Chain calldata/execution measurements are implementation work and may
only *tighten* adapter-local policy, never loosen the protocol caps.

## H. Class A / Class B extensibility mechanism

The committed `u32 profile` field is the entire mechanism, plus a registry:

- **0x00000000 — AMP-signed observations.** The §6.2 mechanism; the only profile in v0.3, valid
  for class A and (as the OQ #1 stopgap) class B. Extension bytes: none.
- **Class B profiles (future, per OQ #1).** Each registry entry defines: the proof system, its
  evidence item schema, its sub-caps (≤ frame caps, §G.5), its adapter verification procedure,
  and its **profile extension bytes** appended after the source array in `P`. Validation:
  `class = A ⇒ profile = 0`; `class = B, profile = 0` means signed observations; a nonzero
  profile with `class = A` is invalid.
- **Stability invariant.** Registering a profile never changes the bytes or hash of any
  existing encoding: profile 0's layout is terminal, the field is already committed, and the
  tag stays `AMP/oracle_params/v1` for all profiles. Existing Class A market IDs are therefore
  unaffected by any number of Class B registrations. Only a change to the *common* layout
  (header, kind union, source entries) bumps the tag to `v2` and is a freeze-level event.
- **Kinds** extend the same way: `kind` is the first discriminator; a new kind value defines
  its own union bytes in the union position; existing kinds' encodings are unchanged.

## I. Rejected alternatives

- **R1. Commit derived EVM addresses (20 B) as source identity.** Rail-specific (keccak is not
  an AMP hash), unrepresentable for ed25519 (no EVM address), insufficient for signature
  verification (pubkeys still needed), and would make the protocol commitment depend on one
  rail's account scheme. Addresses are specified as adapter-internal derived state (§C.5).
- **R2. Commit kids only (32 B), no key material.** Not self-describing: signature
  verification material would live only inside the opaque `canonical_spec_hash`, so
  `oracle_params_hash` alone would not determine resolution. Membership needs the pubkey→kid
  derivation anyway. Kids are derived and stored (§C.7).
- **R3. Merkle source-set commitment with per-observation inclusion proofs.** At n ≤ 32 a
  direct stored list makes membership a ≤ 32-word scan with zero extra calldata; proofs would
  enlarge every evidence item and add a code path per observation, for no privacy or size
  benefit at this scale.
- **R4. Typed `canonical_spec_hash` (fold `oracle_params_hash` inside it).** Equal breaking
  radius, larger philosophical change (the readable JSON stops being the committed artifact;
  question/rules become opaque hashes), loses the standalone params digest. Revisit only if a
  fully on-chain params↔spec check is ever required — it is not, under the anchor-time check +
  dual commitment (§F.3–F.4).
- **R5. Variable-width entries (`alg ‖ pubkey` unpadded).** Parses deterministically (precedent:
  `AMP/kid/v1`), but loses constant stride: sorting, duplicate detection and on-chain walks
  become alg-branching. Rejected on the determinism-first principle; 1 pad byte per ed25519
  source is free.
- **R6. Ordering by kid, or by JSON array order.** Kid-ordering makes canonicalization depend
  on a hash computation before it can begin (more surface, same result); JSON order is
  proposer-arbitrary and demonstrably diverges from canonical order (§E worked example).
  Bytewise over the committed 34-byte entries is self-contained.
- **R7. Include `close_ts` in `oracle_params_hash`.** `f` does not consume it; adapters already
  anchor it once at PROPOSE (§F.4.3). Kept out for scope fidelity; a symmetric
  "timing/instance params" commitment is flagged as follow-up (R9).
- **R8. Class-B-specific byte caps today.** OQ #1 is open; sizing unknown proof systems now
  would either freeze a guess or bloat the shared cap. Frame + per-profile sub-caps (§H, §G.5).
- **R9. Also typing the instance economics now (instance_params_hash in market_id).** Same
  real gap (the game needs windows/bonds/fees on-chain, and the contract can't parse
  `instance_hash`), and Bankr only asked for oracle parameters in OQ #2. Interim posture is
  identical to `close_ts`: anchor-time verification against `instance_hash` + one-time
  storage. Recommended as its own design review (candidate `AMP/market_id/v3`), not smuggled
  into this one.
- **R10. Gas-derived caps.** Explicitly forbidden by the input constraints without measurement;
  all caps in §G are semantic/structural bounds.
- **R11. Count-only cap (no byte cap).** Item size varies (feed string); a count cap alone
  leaves anchor-node work unbounded per item.
- **R12. Keep `market_id` unchanged; commit params only in adapter storage.** No protocol-level
  commitment: two adapters could bind different parameter sets to the same `market_id`
  undetectably at protocol level, and third parties could not re-derive the resolution
  configuration from public data. Also contradicts OQ #2's own proposal ("added to market_id").
- **R13. Per-profile layout/tag churn (`oracle_params/v2`, `v3`, …).** Breaks the Class A ID
  stability invariant (§H) that OQ #2 explicitly demands; the profile field is the version.

## J. Breaking-change analysis

Per AGENTS.md rule 3 this is **breaking** (changes a hash layout). Recommended disposition:
fold into **v0.3-draft** with a **breaking** CHANGELOG entry — matching existing precedent
(v0.3-draft already contains multiple breaking items) and justified because v0.3 never froze
and OQ #2 is on the v0.3 punch list; the signing domain `AMP/0.3/…`, `amp: "0.3"` and the
protocol byte `0x03` are untouched, so non-market-scoped signatures (identity, KEY_BIND,
CAPABILITY_AD) are stable. Alternative — bump to v0.4-draft — rejected as pure churn before
any freeze (every envelope signature in the corpus would change for no architectural gain).

| Artifact | Effect |
|---|---|
| `market_id` value & formula | **Changes** (new tag `AMP/market_id/v2`, sixth component). Old tag removed from §2.4 (nothing is deployed against it). |
| `canonical_spec_hash`, `instance_hash`, `deployment_id`, `kid`, `agent_id`, all §2.4 tags except market_id | Unchanged. |
| Envelope format, type codes, signing digest formula | Unchanged; PROPOSE body `{spec, instance, salt}` unchanged. |
| `f` (§6.4), payout math (§9), bond math (§10.5) | Unchanged — explicitly out of scope. |
| `vectors/jcs.json`, `identity.json`, `parimutuel.json` | Regenerate **byte-identical**. |
| `vectors/market_id.json` | Changes: `market_id` value; adds `oracle_params`, `oracle_params_hash`, sorted entry order. `canonical_spec_hash`/`instance_hash` lines byte-identical. |
| `vectors/envelopes.json` | PROPOSE and SUBMIT_POSITION envelopes re-sign (their `market_id` changed → `envelope_hash`, `signing_digest`, `sig`). CAPABILITY_AD (zero market) byte-identical. |
| `vectors/close.json` | Changes: leaves/root/snapshot embed `market_id`. |
| `vectors/forecast.json` | Changes: commitments embed `market_id`. |
| `vectors/oracle.json` | Case evidence/results **unchanged**; adds `oracle_params_hash` (+ params hex) and `must_reject` cap cases (§L). |
| `vectors/arbitration.json` | Case results **unchanged**; adds `oracle_params_hash`. |
| `schemas/market_spec.schema.json` | Adds `feed` maxLength 128, `sources` maxItems 32. Markets with longer feeds/larger source sets become invalid (none exist). |
| `schemas/observation.schema.json` | Adds `feed` maxLength 128. |
| `schemas/envelope.schema.json` | RESOLVE `evidence` maxItems 64; DISPUTE `evidence` maxItems 64 (byte caps are not schema-expressible; normative text in SPEC §7.6/§10). |
| ACKS.md freeze-hash digest | Informative only; `vectors/` contents change, so the illustrative digest changes. OQ #10 is independent and unresolved. |
| Cross-rail instances of one spec | Unaffected conceptually (`canonical_spec_hash` still identifies the question across rails); every rail's `market_id` changes identically. |

## K. Exact files to modify on approval (single PR)

1. `spec/SPEC.md` — §2.4: add `AMP/oracle_params/v1`, replace `AMP/market_id/v1` row with v2
   layout; §5.2: feed ≤ 128 bytes, n ≤ 32, source-sort derivation note; §5.4: v2 formula;
   new §6.5 "Oracle parameter encoding" (§A–§E of this document, normative phrasing); §7.1:
   PROPOSE anchor-time derivation duty + `market_id` equality; §7.6/§10.2/§10.3: evidence caps
   and check ordering; §13.6: rewrite binding paragraph (typed anchoring set, on-chain
   recomputation of `oracle_params_hash`, alg-verifiability rule §C.6); §14: griefing-bound
   note.
2. `spec/OPEN_QUESTIONS.md` — mark item 2 resolved, link this document.
3. `spec/CHANGELOG.md` — breaking entry (this design).
4. `schemas/market_spec.schema.json`, `5. schemas/observation.schema.json`,
   `6. schemas/envelope.schema.json` — per §J.
7. `reference/python/amp/params.py` — **new**: `encode_params`, `validate_params`,
   `oracle_params_hash`, `derive(spec)`, `validate_evidence(evidence, n)`.
8. `reference/python/amp/market.py` — `market_id()` v2 (six components); `validate_spec`
   gains feed-length and n ≤ 32 rules.
9. `reference/python/amp/oracle.py` — **NOT modified** (`f` untouched).
10. `reference/python/amp/parimutuel.py`, `amp/arbitration.py`, `amp/identity.py`,
    `amp/encoding.py`, `amp/envelope.py`, `amp/forecast.py`, `amp/jcs.py` — not modified.
    (Reviewer option: a three-line guard calling `validate_evidence` at event intake in
    `arbitration.run` to model adapter intake; recommended, non-breaking for all current
    vectors since none exceeds caps.)
11. `reference/python/gen_vectors.py` — emit new `market_id.json`/`oracle.json`/
    `arbitration.json` fields and `must_reject` cap cases.
12. `reference/python/tests/test_amp.py` — per §L.
13. `vectors/*.json` — regenerated only via `gen_vectors.py` (AGENTS.md rule 2); six files
    change per §J, three byte-identical.

Out of repo (not touched by this PR): Bankr/EVM adapter (hold remains until this merges).

## L. Required new/changed conformance vectors and tests

Vectors (all via `gen_vectors.py`, deterministic; the worked-example values in §E must fall
out verbatim):

1. `market_id.json`: add `oracle_params` (hex of `P`), `oracle_params_hash`, and the sorted
   source-entry order; replace `market_id` with the v2 value
   `270971cd…`; confirm `canonical_spec_hash`/`instance_hash` lines unchanged.
2. `oracle.json`: add `oracle_params_hash`; add `must_reject` cases: evidence array with
   `2n+1` items; single item > 640 JCS bytes (maximal feed); duplicate (`alg`, `pubkey`);
   nonzero pad byte; unsorted entries; `quorum > n`; boolean with `2q ≤ n`; `profile ≠ 0`.
3. `arbitration.json`: add `oracle_params_hash`; existing case results must be byte-stable.
4. `envelopes.json` / `close.json` / `forecast.json`: regenerated values only.
5. Determinism case (recommended): the same oracle object with its JSON `sources` array
   permuted must yield the identical `oracle_params_hash` (guards §D.1) — place in
   `market_id.json` as an informative second fixture.

Tests (`test_amp.py`):

6. `oracle_params_hash` reproduces §E's value from the fixture spec.
7. Permutation-invariance and strict-ascending enforcement; duplicate/pad/enum rejection
   (parametrized over each §E rule).
8. `market_id` v2 recomputation and component-order sensitivity.
9. `derive(spec)` == encode round-trip; `validate_evidence` bounds (`2n`, 640 B, ordering of
   checks).
10. Byte-for-byte vector regeneration (existing test covers all ten files automatically).

---

## Reviewer checklist (stop point)

1. Layout §A/§E — field set, widths, enum values, `profile` width.
2. Source representation §C — raw identity + constant stride + derived kid table; EVM address
   derivation §C.5; ed25519 reject-vs-ignore rule §C.6.
3. `market_id` placement §F — direct sixth component (vs R4), tag v2, byte stays 0x03.
4. Caps §G — `2n` / 640 B / derived 40,960 B; pre-verification rejection; shared frame +
   per-profile sub-caps.
5. Extensibility §H — profile registry invariants.
6. Disposition J — fold into v0.3-draft (vs bump), and the R9 follow-up (instance params) as a
   separate review.

No implementation work starts until this review is approved and merged; the PROPOSE /
`market_id` / RESOLVE-intake / DISPUTE-intake hold remains in force until then.
