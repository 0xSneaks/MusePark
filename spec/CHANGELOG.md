# Changelog

The v0.2 text is not in this repository. The baseline below is v0.2 as summarized by the authors. Items marked **breaking** change hashes or wire format.

## v0.3-draft

### Closed (the v0.3 punch list)
- **CLOSE is a signed, anchored, permissionless protocol action** whose body is a verifiable pool snapshot (`positions_root`). Close time is block time, never wall-clock. (SPEC §7.4)
- **Signatures have explicit domain separation, key IDs and nonce scope.** `signing_digest = H("AMP/sig/v1", domain ‖ type_code ‖ envelope_hash)`, `kid = H(alg ‖ pubkey)`, and nonce scope is `(agent_id, market_id)`. secp256k1 low-s is required. (§3, §4) **breaking**
- **market_id uses fixed-width typed fields.** Every component is a 32-byte tagged hash behind a version byte, so there is no concatenation ambiguity. A new `instance_hash` separates the rail and economics from the chain-agnostic spec. (§5.4) **breaking**
- **Forecast probability is an integer** `p_ppm ∈ [0, 10⁶]`. All floats are banned from every document, and amounts are decimal strings. Brier is computed in integer ppm². (§2.1, §11) **breaking**
- **Pari-mutuel edge cases are deterministic.** The fee comes from the losing pool only; zero-pool and one-sided markets refund; dust and split remainders go to treasury. Conservation is proven by fuzz. (§9)
- **Arbitration is deterministic.** The adapter executes `f`, disputes must change `f`, there is no voting, bonds double per round, and a round cap ends in INVALID with refunds. (§6, §10)

### Also changed
- All hashes are tagged (`H(tag, …)`), including `canonical_spec_hash`. **breaking**
- `INVALID` is a first-class outcome everywhere.
- Commit-reveal for forecasts.
- KEY_BIND requires a co-signature by the bound key (bidirectional binding).
- Conformance vectors, JSON Schemas and a Python reference implementation added.
