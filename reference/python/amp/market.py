"""Canonical market spec, rail instance, market_id, positions root (spec sections 5, 7.4)."""
from .encoding import H, u8, u64, u128, amount, signed_int, unhex
from .identity import ALG, PUBKEY_LEN, kid
from .jcs import canonicalize

SPEC_VERSION_BYTE = 0x03
COMPARATORS = ("gt", "gte", "lt", "lte")
ORACLE_KINDS = ("numeric_threshold", "boolean_attestation")
SIDES = {"YES": 1, "NO": 2}


class SpecError(ValueError):
    pass


def deployment_id(name: str) -> bytes:
    return H("AMP/deployment/v1", name.encode("utf-8"))


def feed_id(feed: str) -> bytes:
    return H("AMP/feed/v1", feed.encode("utf-8"))


def canonical_spec_hash(spec: dict) -> bytes:
    validate_spec(spec)
    return H("AMP/spec/v1", canonicalize(spec))


def instance_hash(instance: dict) -> bytes:
    validate_instance(instance)
    return H("AMP/instance/v1", canonicalize(instance))


def market_id(deployment: str, spec: dict, instance: dict, proposer: bytes, salt: bytes) -> bytes:
    if len(proposer) != 32 or len(salt) != 32:
        raise SpecError("proposer and salt must be 32 bytes")
    return H("AMP/market_id/v1", u8(SPEC_VERSION_BYTE), deployment_id(deployment),
             canonical_spec_hash(spec), instance_hash(instance), proposer, salt)


def source_ids(oracle: dict) -> list[bytes]:
    return [kid(s["alg"], unhex(s["pubkey"])) for s in oracle["sources"]]


def validate_spec(spec: dict):
    req = {"amp", "question", "rules", "close_ts", "oracle"}
    if set(spec) != req:
        raise SpecError(f"spec keys must be exactly {sorted(req)}")
    if spec["amp"] != "0.3":
        raise SpecError("amp must be '0.3'")
    o = spec["oracle"]
    common = {"kind", "class", "feed", "observation_ts", "finality_delay", "publish_window", "sources", "quorum"}
    if o.get("kind") not in ORACLE_KINDS:
        raise SpecError("unknown oracle kind")
    extra = {"decimals", "comparator", "threshold"} if o["kind"] == "numeric_threshold" else set()
    if set(o) != common | extra:
        raise SpecError(f"oracle keys must be exactly {sorted(common | extra)}")
    if o["class"] not in ("A", "B"):
        raise SpecError("oracle class must be A or B")
    for k in ("observation_ts", "finality_delay", "publish_window", "quorum"):
        if not isinstance(o[k], int) or isinstance(o[k], bool) or o[k] < 0:
            raise SpecError(f"{k} must be a non-negative integer")
    if not isinstance(spec["close_ts"], int) or spec["close_ts"] > o["observation_ts"]:
        raise SpecError("close_ts must be an integer <= oracle.observation_ts")
    srcs = o["sources"]
    if not srcs:
        raise SpecError("at least one source required")
    for s in srcs:
        if set(s) != {"alg", "pubkey"} or s["alg"] not in ALG:
            raise SpecError("source must be {alg, pubkey}")
        unhex(s["pubkey"], PUBKEY_LEN[s["alg"]])
    ids = source_ids(o)
    if len(set(ids)) != len(ids):
        raise SpecError("duplicate source")
    n, q = len(srcs), o["quorum"]
    if not 1 <= q <= n:
        raise SpecError("quorum must be in [1, n]")
    if o["kind"] == "boolean_attestation" and 2 * q <= n:
        raise SpecError("boolean_attestation requires quorum > n/2")
    if o["kind"] == "numeric_threshold":
        if o["comparator"] not in COMPARATORS:
            raise SpecError("bad comparator")
        if not isinstance(o["decimals"], int) or not 0 <= o["decimals"] <= 36:
            raise SpecError("decimals must be integer in [0, 36]")
        signed_int(o["threshold"])


def validate_instance(inst: dict):
    req = {"rail", "collateral", "creation_fee", "fee_bps", "fee_split_bps", "min_stake",
           "resolver_bond", "resolve_window", "dispute_window", "max_rounds", "reveal_window"}
    if set(inst) != req:
        raise SpecError(f"instance keys must be exactly {sorted(req)}")
    for k in ("creation_fee", "min_stake", "resolver_bond"):
        amount(inst[k])
    if amount(inst["min_stake"]) == 0 or amount(inst["resolver_bond"]) == 0:
        raise SpecError("min_stake and resolver_bond must be > 0")
    if not isinstance(inst["fee_bps"], int) or not 0 <= inst["fee_bps"] <= 10000:
        raise SpecError("fee_bps in [0, 10000]")
    split = inst["fee_split_bps"]
    if set(split) != {"proposer", "resolver", "settler", "treasury"}:
        raise SpecError("fee_split_bps keys")
    if any(not isinstance(v, int) or v < 0 for v in split.values()) or sum(split.values()) != 10000:
        raise SpecError("fee_split_bps must be non-negative and sum to 10000")
    for k in ("resolve_window", "dispute_window", "reveal_window"):
        if not isinstance(inst[k], int) or inst[k] <= 0:
            raise SpecError(f"{k} must be a positive integer")
    if not isinstance(inst["max_rounds"], int) or not 1 <= inst["max_rounds"] <= 32:
        raise SpecError("max_rounds in [1, 32]")


# --- positions root -----------------------------------------------------------

def position_leaf(mid: bytes, index: int, agent: bytes, side: str, amt: int) -> bytes:
    return H("AMP/position/v1", mid, u64(index), agent, u8(SIDES[side]), u128(amt))


def merkle_root(leaves: list[bytes]) -> bytes:
    """Binary SHA-256 tree; an odd node is promoted unchanged (never duplicated)."""
    if not leaves:
        return H("AMP/empty/v1")
    level = list(leaves)
    while len(level) > 1:
        nxt = [H("AMP/node/v1", level[i], level[i + 1]) for i in range(0, len(level) - 1, 2)]
        if len(level) % 2:
            nxt.append(level[-1])
        level = nxt
    return level[0]


def close_snapshot(mid: bytes, positions: list[dict]) -> dict:
    """positions: anchored-order list of {agent_id, side, amount} with anchored_ts < close_ts."""
    leaves, yes, no = [], 0, 0
    for i, p in enumerate(positions):
        a = amount(p["amount"])
        leaves.append(position_leaf(mid, i, unhex(p["agent_id"], 32), p["side"], a))
        if p["side"] == "YES":
            yes += a
        else:
            no += a
    return {"yes_pool": str(yes), "no_pool": str(no), "position_count": len(positions),
            "positions_root": merkle_root(leaves).hex()}
