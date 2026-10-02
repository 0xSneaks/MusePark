"""Agent identities, key IDs and raw signatures (spec section 3)."""
import coincurve
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from .encoding import H, u8, u64

ALG = {"ed25519": 0x01, "secp256k1": 0x02}
PUBKEY_LEN = {"ed25519": 32, "secp256k1": 33}
SIG_LEN = {"ed25519": 64, "secp256k1": 65}
SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141


def _check(alg: str, pubkey: bytes):
    if alg not in ALG:
        raise ValueError(f"unknown alg {alg}")
    if len(pubkey) != PUBKEY_LEN[alg]:
        raise ValueError("bad pubkey length")


def kid(alg: str, pubkey: bytes) -> bytes:
    _check(alg, pubkey)
    return H("AMP/kid/v1", u8(ALG[alg]), pubkey)


def agent_id(root_alg: str, root_pubkey: bytes) -> bytes:
    _check(root_alg, root_pubkey)
    return H("AMP/agent_id/v1", u8(ALG[root_alg]), root_pubkey)


def keybind_digest(agent: bytes, new_kid: bytes, valid_from: int) -> bytes:
    return H("AMP/keybind/v1", agent, new_kid, u64(valid_from))


def pubkey_of(alg: str, priv: bytes) -> bytes:
    if alg == "ed25519":
        return Ed25519PrivateKey.from_private_bytes(priv).public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    if alg == "secp256k1":
        return coincurve.PrivateKey(priv).public_key.format(compressed=True)
    raise ValueError(alg)


def sign(alg: str, priv: bytes, digest: bytes) -> bytes:
    """Sign a 32-byte digest.

    ed25519   -> 64 bytes (RFC 8032, message = the 32 digest bytes)
    secp256k1 -> 65 bytes r||s||recid, RFC 6979 nonce, low-s
    """
    if len(digest) != 32:
        raise ValueError("digest must be 32 bytes")
    if alg == "ed25519":
        return Ed25519PrivateKey.from_private_bytes(priv).sign(digest)
    if alg == "secp256k1":
        return coincurve.PrivateKey(priv).sign_recoverable(digest, hasher=None)
    raise ValueError(alg)


def verify(alg: str, pubkey: bytes, digest: bytes, sig: bytes) -> bool:
    _check(alg, pubkey)
    if len(sig) != SIG_LEN[alg]:
        return False
    if alg == "ed25519":
        try:
            Ed25519PublicKey.from_public_bytes(pubkey).verify(sig, digest)
            return True
        except InvalidSignature:
            return False
    r = int.from_bytes(sig[:32], "big")
    s = int.from_bytes(sig[32:64], "big")
    if sig[64] not in (0, 1) or not (0 < r < SECP256K1_N) or not (0 < s <= SECP256K1_N // 2):
        return False  # high-s rejected: signatures must be non-malleable
    try:
        rec = coincurve.PublicKey.from_signature_and_message(sig, digest, hasher=None)
    except Exception:
        return False
    return rec.format(compressed=True) == pubkey
