"""Fixed-width binary encodings and tagged hashing (spec section 2)."""
import hashlib

U128_MAX = 2**128 - 1


def H(tag: str, *parts: bytes) -> bytes:
    """Tagged SHA-256: SHA-256(ascii(tag) || 0x00 || parts...).

    Tags never contain 0x00, so the tag/payload boundary is unambiguous.
    """
    assert "\x00" not in tag and tag.isascii()
    h = hashlib.sha256(tag.encode("ascii") + b"\x00")
    for p in parts:
        h.update(p)
    return h.digest()


def u8(n: int) -> bytes:
    return n.to_bytes(1, "big")


def u16(n: int) -> bytes:
    return n.to_bytes(2, "big")


def u32(n: int) -> bytes:
    return n.to_bytes(4, "big")


def u64(n: int) -> bytes:
    return n.to_bytes(8, "big")


def u128(n: int) -> bytes:
    return n.to_bytes(16, "big")


def i128(n: int) -> bytes:
    return n.to_bytes(16, "big", signed=True)


def hx(b: bytes) -> str:
    return b.hex()


def unhex(s: str, n: int | None = None) -> bytes:
    if not isinstance(s, str) or s != s.lower():
        raise ValueError("hex must be a lowercase string")
    b = bytes.fromhex(s)
    if n is not None and len(b) != n:
        raise ValueError(f"expected {n} bytes, got {len(b)}")
    return b


def amount(s: str) -> int:
    """Parse a canonical unsigned decimal amount string (<= u128)."""
    if not isinstance(s, str) or not s.isascii() or not s.isdigit() or (len(s) > 1 and s[0] == "0"):
        raise ValueError(f"non-canonical amount {s!r}")
    n = int(s)
    if n > U128_MAX:
        raise ValueError("amount exceeds u128")
    return n


def signed_int(s: str) -> int:
    """Parse a canonical signed decimal string fitting i128."""
    if not isinstance(s, str) or not s.isascii():
        raise ValueError(f"non-canonical integer {s!r}")
    neg = s.startswith("-")
    body = s[1:] if neg else s
    if not body.isdigit() or (len(body) > 1 and body[0] == "0") or s == "-0":
        raise ValueError(f"non-canonical integer {s!r}")
    n = int(s)
    if not -(2**127) <= n < 2**127:
        raise ValueError("integer exceeds i128")
    return n
