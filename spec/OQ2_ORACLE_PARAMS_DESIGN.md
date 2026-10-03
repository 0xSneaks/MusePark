# OQ #2 design review — on-chain oracle parameters (`oracle_params_hash`)

**Status:** REVISED FOR REVIEW after independent adversarial review. Nothing in this document is normative yet.
No implementation work starts until this design is approved and merged. The implementation hold on
PROPOSE / `market_id` / RESOLVE intake / DISPUTE intake remains in force.

**Scope:** resolve OPEN_QUESTIONS.md item 2 (BLOCKS-FREEZE) under the Bankr implementation constraints.
Design only — `f`, payout math, bond math, arbitration semantics and the Bankr adapter remain unchanged.

**Non-goals:** OQ #1 (future Class-B proof systems), OQ #10 (freeze hash), gas benchmarking,
instance-parameter typing / `close_ts` commitment (R9 follow-up).

---

## 0. Review corrections

This revision closes the three blockers found in the independent review:

1. **Versioning:** this changes a hash layout and therefore follows `AGENTS.md` rule 3 by moving the
   draft to **AMP v0.4-draft**. The implementation PR must update `amp` to `"0.4"`, the signing
   domain to `AMP/0.4/<deployment>`, and the protocol version byte to `0x04`.
2. **Fixed-width contract preimage:** `P` is now **exactly 1,218 bytes for every market**. There are
   no variable-length regions in the `oracle_params_hash` preimage.
3. **Evidence sizing:** the 640-byte JCS rule is removed. Profile-0 evidence is represented to the
   adapter in one deterministic **162-byte typed encoding**, while the JSON `feed` is separately
   bounded by decoded UTF-8 byte length.

The original architectural choices that survived review are retained: raw source identity, bytewise source
sorting, direct `oracle_params_hash` inclusion in `market_id`, `2n` evidence-count sufficiency, and a profile
registry that does not perturb existing Class-A encodings.

---

## A. Version disposition

Per `AGENTS.md` rule 3, a change to a hash/digest layout or wire field is breaking and requires a draft-version
bump. This design therefore targets **v0.4-draft**.

Implementation consequences:

- canonical market specs use `"amp": "0.4"`;
- signing domain becomes `AMP/0.4/<deployment_name>`;
- the leading protocol byte in `market_id` becomes `0x04`;
- `market_id` uses the new layout tag `AMP/market_id/v2`;
- `canonical_spec_hash` keeps the same tagged-hash definition, but its value changes because the spec's
  `amp` field changes from `0.3` to `0.4`;
- all market-scoped envelopes re-sign; non-market-scoped envelopes also re-sign because the domain changes.

This is acceptable before freeze and is required by the repo's explicit contribution rules.

---

## B. Fixed-width oracle parameter encoding

### B.1 Layout

`oracle_params_hash = H("AMP/oracle_params/v1", P)` where **`P` is always exactly 1,218 bytes**:

| offset | size | field | encoding |
|---|---:|---|---|
| 0 | 1 | `kind` | `0x01` numeric, `0x02` boolean |
| 1 | 1 | `class` | `0x01` A, `0x02` B |
| 2 | 4 | `profile` | u32; profile `0` is AMP signed observations |
| 6 | 32 | `feed_id` | `H("AMP/feed/v1", UTF-8(feed))` |
| 38 | 8 | `observation_ts` | u64 big-endian |
| 46 | 8 | `finality_delay` | u64 big-endian |
| 54 | 8 | `publish_window` | u64 big-endian |
| 62 | 2 | `source_count` | u16, `1..32` |
| 64 | 2 | `quorum` | u16, `1..source_count` |
| 66 | 32 | `kind_payload` | fixed 32-byte slot, below |
| 98 | 1088 | `source_slots` | exactly 32 × 34-byte slots |
| 1186 | 32 | `profile_params_hash` | fixed digest slot |

Total: `98 + (32 × 34) + 32 = 1,218` bytes.

### B.2 Kind payload

The kind slot is always 32 bytes.

**numeric_threshold:**

```text
u8 comparator || u8 decimals || i128 threshold || 14 zero bytes
```

Comparator registry: `gt=0x01`, `gte=0x02`, `lt=0x03`, `lte=0x04`.

**boolean_attestation:** all 32 bytes MUST be zero.

Any nonzero reserved byte is invalid. A future kind that cannot fit in the fixed slot requires a new common-layout
version; it does not silently extend `P`.

### B.3 Source slots

Each source occupies one 34-byte slot:

```text
entry = u8 alg || key_slot[33]

ed25519:   0x01 || pubkey[32] || 0x00
secp256k1: 0x02 || compressed_pubkey[33]
```

Rules:

- active entries are sorted ascending bytewise over all 34 bytes;
- active entries must be strictly increasing, so duplicates are structurally rejected;
- the first `source_count` slots are active;
- every remaining slot through slot 31 MUST be exactly 34 zero bytes;
- algorithm byte `0x00` is never valid for an active slot and is reserved for padding only.

This preserves constant-stride parsing while making the entire commitment preimage fixed-width.

### B.4 Profile parameter commitment

For profile `0`, `profile_params_hash` MUST be 32 zero bytes.

Future nonzero profiles define a tagged hash for any profile-specific parameter document or typed blob and place
that 32-byte digest in `profile_params_hash`. The future profile specification must separately define how adapters
obtain and validate those parameters. Registering a new profile therefore never changes the bytes of profile-0
markets.

---

## C. Source identity and adapter verification

The canonical source identity remains `(algorithm_id, pubkey_bytes)`.

```text
kid = H("AMP/kid/v1", u8 alg || pubkey)
```

At PROPOSE, the adapter derives and stores the `kid` table from the active source slots. RESOLVE/DISPUTE evidence
looks up `source_id` in that stored table and verifies the source signature against the stored key.

### C.1 EVM secp256k1 derivation

The commitment stores the compressed public key, never an EVM address. An EVM adapter derives the address once:

```text
(X, Y) = decompress(compressed_pubkey)
evm_address = keccak256(0x04 || X || Y)[12:32]
```

Verification uses `ecrecover` against that derived address. Keccak never enters an AMP commitment preimage.

### C.2 Unsupported algorithms

An adapter MUST reject a market at PROPOSE if it cannot verify every committed source algorithm. It MUST NOT
anchor the market and later treat unsupported-source observations as merely invalid, because that would silently
change effective quorum.

---

## D. Oracle-parameter validation rules

Before hashing `P`, implementations MUST enforce:

- `kind ∈ {0x01, 0x02}`;
- `class ∈ {0x01, 0x02}`;
- v0.4 initially permits only `profile = 0` until a later profile is normatively registered;
- `1 ≤ source_count ≤ 32`;
- `1 ≤ quorum ≤ source_count`;
- boolean markets require `2 × quorum > source_count`;
- numeric comparator must be one of the four registered values;
- numeric `decimals ∈ [0,36]`;
- numeric threshold is any i128;
- kind reserved bytes are zero;
- active source slots are valid and strictly sorted;
- inactive source slots are all zero;
- profile `0` requires an all-zero `profile_params_hash`.

The JSON-layer `feed` rule is:

```text
1 ≤ len(UTF-8(feed)) ≤ 128 bytes
```

This byte-length rule is normative and must be enforced in the reference validator. JSON Schema `maxLength: 128`
may remain as a coarse prefilter, but it is not sufficient by itself because JSON Schema measures string length,
not the protocol's decoded UTF-8 byte limit.

---

## E. `market_id` binding

`oracle_params_hash` enters `market_id` directly:

```text
market_id = H("AMP/market_id/v2",
              u8 0x04 ||
              deployment_id ||
              canonical_spec_hash ||
              oracle_params_hash ||
              instance_hash ||
              proposer_agent_id ||
              salt)
```

There is no commitment cycle:

```text
oracle JSON -> derive fixed P -> oracle_params_hash ---+
spec JSON   -> JCS(spec) -> canonical_spec_hash -------|
instance JSON -> instance_hash -------------------------|-> market_id
deployment name -> deployment_id -----------------------|
proposer_agent_id + salt -------------------------------+
```

A conforming adapter derives `P` from the same spec whose JCS hash produced `canonical_spec_hash`, verifies both
commitments, verifies the PROPOSE signature, and only then anchors the typed parameters.

The contract never parses JSON. It receives the fixed typed set, recomputes `oracle_params_hash` and `market_id`,
and stores the source/key table plus the fields needed by `f`.

---

## F. Evidence representation and griefing bounds

### F.1 Claim count

The semantic count cap remains:

```text
MAX_EVIDENCE_ITEMS_PER_CLAIM = 2 × source_count   (absolute max 64)
```

This is sufficient because for each source, §6.4 only needs the earliest eligible `published_ts`, and at that time
at most two distinct signed values matter: two values already establish equivocation.

### F.2 Fixed typed evidence encoding

The protocol no longer sizes evidence by JCS bytes. For profile `0`, every observation is converted by the adapter
to this fixed **162-byte typed encoding** before on-chain verification:

| field | bytes | rule |
|---|---:|---|
| `source_id` | 32 | kid |
| `feed_id` | 32 | tagged hash of decoded feed |
| `observation_ts` | 8 | u64 big-endian |
| `published_ts` | 8 | u64 big-endian |
| `value_slot` | 17 | fixed form below |
| `sig_slot` | 65 | fixed form below |

Total: `32 + 32 + 8 + 8 + 17 + 65 = 162` bytes.

`value_slot`:

```text
numeric: 0x01 || i128(value)                         # 17 bytes
boolean: 0x02 || u8(0|1) || 15 zero bytes           # 17 bytes
```

`sig_slot`:

```text
ed25519:   signature[64] || 0x00
secp256k1: signature[65]
```

The active source's algorithm determines which signature form is valid; a nonzero ed25519 pad byte is invalid.

The source signature digest remains the existing AMP digest over
`source_id || feed_id || observation_ts || published_ts || value`.

### F.3 Validation order

For RESOLVE/DISPUTE, validation is ordered:

1. decode envelope / schema shape;
2. enforce decoded UTF-8 `feed` byte limit;
3. enforce evidence count `≤ 2n`;
4. derive each 162-byte typed evidence item;
5. reject malformed typed slots/padding before signature verification;
6. verify signatures;
7. enforce seq/window/bond rules;
8. execute `f`.

This makes the same typed representation available to off-chain validators and on-chain adapters and removes the
cross-layer ambiguity of a JCS-byte cap.

No separate per-item JCS limit is normative. Relayers MAY impose local raw-request limits so long as they do not
reject any protocol-valid canonical envelope.

### F.4 Future Class-B profiles

A future profile must define its own fixed typed evidence encoding and caps before registration. Its per-claim
limits MUST be no looser than the common source-count frame unless a future protocol version explicitly changes
that rule. Profile registration does not alter profile-0 encodings or market IDs.

---

## G. Worked fixture targets

These values were independently recomputed from the current `vectors/market_id.json` fixture, changing only the
protocol version to v0.4 and applying this fixed-width design. They are **review targets** until generated by the
reference implementation; vectors must still be produced only by `gen_vectors.py`.

For `TEST/USD`, class A, numeric `gte`, decimals `2`, threshold `10000000`, three ed25519 sources, quorum `2`:

```text
len(P) = 1218
oracle_params_hash = d387a9fe6999e6bc97e8f40e1be5fb0364f6ea852c549d962ca1c381fe38f06e
canonical_spec_hash(v0.4) = 6a6f9f7bccd4c6d1c2029af6a0c42d9e3413d66569f0ab6e15e7389d8ab2833d
market_id(v2, protocol byte 0x04) = 6bc0d4e35b1ab8361da5e7d9d68d061c1f953729a9390eb1ff211a6c5ef42d95
```

The implementation PR MUST reproduce these values independently from the fixture. A mismatch blocks merge and the
hand-computed values do not override generated vectors.

---

## H. Breaking-change analysis

This design is intentionally breaking and moves the repository to **v0.4-draft**.

| Artifact | Effect |
|---|---|
| spec `amp` field | `0.3` -> `0.4` |
| signing domain | `AMP/0.3/...` -> `AMP/0.4/...` |
| protocol version byte | `0x03` -> `0x04` |
| `market_id` | new `AMP/market_id/v2` layout with `oracle_params_hash` |
| `canonical_spec_hash` | definition unchanged; value changes because spec version changes |
| `oracle_params_hash` | new fixed 1,218-byte preimage |
| envelope schemas | shapes unchanged except evidence count maxima; signatures regenerate |
| `f`, payout math, bond math | unchanged |
| source observation digest | unchanged |
| feed validation | adds decoded UTF-8 byte bound |
| evidence sizing | removes JCS-byte cap; adds fixed profile-0 typed encoding |
| current vectors | market-scoped/signature-dependent files regenerate |

---

## I. Implementation plan after design approval

One implementation PR should make the following normative/code changes:

1. `spec/SPEC.md`
   - move title/status to v0.4-draft;
   - update signing domain and protocol byte;
   - register `AMP/oracle_params/v1` and `AMP/market_id/v2`;
   - specify fixed `P`, fixed source slots, feed UTF-8 byte bound, typed evidence form and count cap;
   - update PROPOSE and adapter obligations.
2. `spec/OPEN_QUESTIONS.md`
   - mark OQ #2 resolved and link this design.
3. `spec/CHANGELOG.md`
   - add the v0.4 breaking entry.
4. Schemas
   - spec `amp` const becomes `0.4`;
   - `sources.maxItems = 32`;
   - `feed.maxLength = 128` only as a coarse schema prefilter;
   - RESOLVE/DISPUTE `evidence.maxItems = 64` as an absolute schema ceiling.
5. `reference/python/amp/params.py` (new)
   - fixed-width `encode_params` / validation / hash;
   - source-slot padding rules;
   - typed evidence encoder;
   - decoded UTF-8 feed-byte validation.
6. `reference/python/amp/market.py`
   - v0.4 validation and `market_id/v2`.
7. `reference/python/amp/oracle.py`
   - `f` remains unchanged.
8. `gen_vectors.py` and tests
   - regenerate vectors; never hand-edit `/vectors`.

R9 remains separate: instance economics / `close_ts` are still stored once at PROPOSE after anchor-time validation
against `instance_hash`. A future typed `instance_params_hash` must get its own design review rather than being
silently added here.

---

## J. Required tests and vectors

The implementation PR must add tests for:

1. `len(P) == 1218` for numeric and boolean markets, for `n=1` and `n=32`;
2. exact fixture `oracle_params_hash` above;
3. exact v0.4 `canonical_spec_hash` and `market_id` above;
4. source-array permutation invariance;
5. rejection of duplicate, unsorted, malformed and nonzero padded source slots;
6. rejection of nonzero boolean kind payload and nonzero reserved numeric bytes;
7. rejection of nonzero profile-0 params hash;
8. feed decoded UTF-8 byte lengths 128 accepted / 129 rejected, including multibyte Unicode cases;
9. profile-0 typed evidence length exactly 162;
10. ed25519 and secp256k1 signature-slot padding rules;
11. evidence count `2n` accepted / `2n+1` rejected;
12. byte-for-byte vector regeneration and existing `f`/payout/bond cases unchanged in result semantics.

Vector generation must emit the new fixed `P`, `oracle_params_hash`, sorted active source slots, v0.4 spec hash and
`market_id/v2` values from code. The hand-computed targets in §G are checks, not authoritative vector edits.

---

## Reviewer checklist

Approve only if all are true:

1. version bump to v0.4 satisfies `AGENTS.md` rule 3;
2. `P` is truly fixed at 1,218 bytes with no implicit variable tail;
3. source identity / ordering / padding are unambiguous;
4. direct `oracle_params_hash` placement creates no cycle;
5. profile-0 evidence has one deterministic 162-byte typed form;
6. UTF-8 feed-byte semantics are explicit and testable;
7. `2n` remains sufficient under §6.4;
8. future profiles cannot change existing Class-A encodings;
9. R9 stays explicitly separate.

No implementation work starts until this review is approved and merged.
