"""Deterministic oracle evaluation f(evidence) -> (outcome, reason) (spec section 6)."""
from .encoding import H, u8, u64, i128, signed_int, unhex, hx
from .identity import verify, kid, sign
from .market import feed_id

VALUE_NUMERIC = 0x01
VALUE_BOOLEAN = 0x02


def _value_bytes(kind: str, value):
    if kind == "numeric_threshold":
        if not isinstance(value, str):
            raise ValueError("numeric value must be a decimal string")
        return u8(VALUE_NUMERIC) + i128(signed_int(value))
    if not isinstance(value, bool):
        raise ValueError("boolean value must be true/false")
    return u8(VALUE_BOOLEAN) + u8(1 if value else 0)


def observation_digest(kind: str, obs: dict) -> bytes:
    return H("AMP/observation/v1", unhex(obs["source_id"], 32), feed_id(obs["feed"]),
             u64(obs["observation_ts"]), u64(obs["published_ts"]), _value_bytes(kind, obs["value"]))


def sign_observation(kind: str, obs: dict, alg: str, priv: bytes) -> dict:
    out = {k: v for k, v in obs.items() if k != "sig"}
    out["sig"] = hx(sign(alg, priv, observation_digest(kind, out)))
    return out


def _valid(o: dict, obs: dict, sources: dict) -> bool:
    try:
        if set(obs) != {"source_id", "feed", "observation_ts", "published_ts", "value", "sig"}:
            return False
        src = sources.get(obs["source_id"])
        if src is None or obs["feed"] != o["feed"] or obs["observation_ts"] != o["observation_ts"]:
            return False
        lo = o["observation_ts"] + o["finality_delay"]
        if not lo <= obs["published_ts"] <= lo + o["publish_window"]:
            return False
        return verify(src["alg"], unhex(src["pubkey"]), observation_digest(o["kind"], obs), unhex(obs["sig"]))
    except (ValueError, KeyError, TypeError):
        return False


def evaluate(oracle: dict, evidence: list[dict]) -> dict:
    """Pure function of (oracle, evidence set). Order of evidence does not matter."""
    sources = {hx(kid(s["alg"], unhex(s["pubkey"]))): s for s in oracle["sources"]}
    per_source: dict[str, dict[int, set]] = {}
    for obs in evidence:
        if _valid(oracle, obs, sources):
            v = obs["value"] if oracle["kind"] == "boolean_attestation" else signed_int(obs["value"])
            per_source.setdefault(obs["source_id"], {}).setdefault(obs["published_ts"], set()).add(v)

    chosen, equivocated = {}, []
    for sid, by_ts in per_source.items():
        first = min(by_ts)  # revision policy: earliest eligible publication wins
        vals = by_ts[first]
        if len(vals) > 1:
            equivocated.append(sid)  # two signed values for the same slot: source excluded
        else:
            chosen[sid] = next(iter(vals))

    q = oracle["quorum"]
    result = {"chosen": {k: (v if isinstance(v, bool) else str(v)) for k, v in sorted(chosen.items())},
              "equivocated": sorted(equivocated)}
    if len(chosen) < q:
        return {"outcome": "INVALID", "reason": "QUORUM_NOT_MET", **result}

    if oracle["kind"] == "boolean_attestation":
        t = sum(1 for v in chosen.values() if v)
        f = len(chosen) - t
        if t >= q:
            return {"outcome": "YES", "reason": "OK", **result}
        if f >= q:
            return {"outcome": "NO", "reason": "OK", **result}
        return {"outcome": "INVALID", "reason": "QUORUM_NOT_MET", **result}

    vals = sorted(chosen.values())
    m = vals[(len(vals) - 1) // 2]  # lower median keeps the result an observed integer
    t = signed_int(oracle["threshold"])
    yes = {"gt": m > t, "gte": m >= t, "lt": m < t, "lte": m <= t}[oracle["comparator"]]
    return {"outcome": "YES" if yes else "NO", "reason": "OK", "median": str(m), **result}
