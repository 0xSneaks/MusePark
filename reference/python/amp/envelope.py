"""Signed message envelope (spec section 4)."""
from .encoding import H, u16, u32, hx, unhex
from .identity import sign, verify, kid as compute_kid
from .jcs import canonicalize

MSG_TYPES = {
    "PROPOSE": 0x0001,
    "CLAIM_ROLE": 0x0002,
    "FORECAST_COMMIT": 0x0003,
    "FORECAST_REVEAL": 0x0004,
    "SUBMIT_POSITION": 0x0005,
    "CLOSE": 0x0006,
    "RESOLVE": 0x0007,
    "VERIFY_PROOF": 0x0008,
    "DISPUTE": 0x0009,
    "SETTLE": 0x000A,
    "KEY_BIND": 0x0010,
    "KEY_REVOKE": 0x0011,
    "CAPABILITY_AD": 0x0012,
}

ZERO32 = "00" * 32  # market_id for messages not scoped to a market


def domain(deployment: str) -> bytes:
    return f"AMP/0.3/{deployment}".encode("utf-8")


def envelope_hash(env: dict) -> bytes:
    body = {k: v for k, v in env.items() if k != "sig"}
    return H("AMP/envelope/v1", canonicalize(body))


def signing_digest(env: dict, deployment: str) -> bytes:
    d = domain(deployment)
    t = MSG_TYPES[env["type"]]
    return H("AMP/sig/v1", u32(len(d)), d, u16(t), envelope_hash(env))


def sign_envelope(env: dict, deployment: str, alg: str, priv: bytes) -> dict:
    out = {k: v for k, v in env.items() if k != "sig"}
    out["sig"] = hx(sign(alg, priv, signing_digest(out, deployment)))
    return out


def verify_envelope(env: dict, deployment: str, alg: str, pubkey: bytes) -> bool:
    """Cryptographic check only. Key validity windows, seq ordering and expiry are
    checked by the caller against anchored time (spec 4.4)."""
    if env.get("kid") != hx(compute_kid(alg, pubkey)):
        return False
    try:
        sig = unhex(env["sig"])
    except (KeyError, ValueError):
        return False
    return verify(alg, pubkey, signing_digest(env, deployment), sig)


class SeqTracker:
    """Replay protection: seq strictly increases per (agent_id, market_id) scope."""

    def __init__(self):
        self._last: dict[tuple[str, str], int] = {}

    def accept(self, env: dict, anchored_ts: int) -> bool:
        if anchored_ts > env["expires_at"]:
            return False
        scope = (env["from"], env["market_id"])
        if scope in self._last and env["seq"] <= self._last[scope]:
            return False
        self._last[scope] = env["seq"]
        return True
