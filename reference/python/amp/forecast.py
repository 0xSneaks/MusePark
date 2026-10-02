"""Forecast commit-reveal and integer Brier scoring (spec section 11)."""
from .encoding import H, u32

PPM = 1_000_000


def commitment(market: bytes, agent: bytes, p_ppm: int, salt: bytes) -> bytes:
    if not isinstance(p_ppm, int) or isinstance(p_ppm, bool) or not 0 <= p_ppm <= PPM:
        raise ValueError("p_ppm must be an integer in [0, 1000000]")
    if len(market) != 32 or len(agent) != 32 or len(salt) != 32:
        raise ValueError("market, agent, salt must be 32 bytes")
    return H("AMP/forecast/v1", market, agent, u32(p_ppm), salt)


def brier_ppm2(p_ppm: int, outcome: str) -> int:
    """Squared error in ppm^2. 0 is perfect, 10^12 is maximally wrong.
    Only YES/NO outcomes are scored; INVALID markets produce no score."""
    if outcome not in ("YES", "NO"):
        raise ValueError("only YES/NO markets are scored")
    o = PPM if outcome == "YES" else 0
    return (p_ppm - o) ** 2


class Reputation:
    """Raw aggregate. Weighting is deliberately out of scope for v0.3 (OPEN_QUESTIONS.md)."""

    def __init__(self):
        self.sum_ppm2 = 0
        self.count = 0

    def add(self, p_ppm: int, outcome: str):
        self.sum_ppm2 += brier_ppm2(p_ppm, outcome)
        self.count += 1

    def mean_ppm2(self) -> int:
        return self.sum_ppm2 // self.count if self.count else 0
