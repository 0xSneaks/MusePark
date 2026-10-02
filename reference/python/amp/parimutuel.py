"""Deterministic pari-mutuel settlement (spec section 9). All integer base units."""
from .encoding import amount

ROLES = ("proposer", "resolver", "settler")


def settle(positions: list[dict], outcome: str, fee_bps: int, split: dict) -> dict:
    """positions: [{side: YES|NO, amount: str}] in positions-root order.

    Returns per-position payouts and fee distribution. Invariant:
        sum(payouts) + fee_total + dust == yes_pool + no_pool
    where fee_total is fully distributed across roles + treasury and dust goes
    to treasury (treasury_total = treasury fee share + split remainder + dust).
    """
    stakes = [(p["side"], amount(p["amount"])) for p in positions]
    yes = sum(a for s, a in stakes if s == "YES")
    no = sum(a for s, a in stakes if s == "NO")
    zero_shares = {r: "0" for r in ROLES}

    def refund(case):
        return {"case": case, "payouts": [str(a) for _, a in stakes], "fee_total": "0",
                "fee_shares": zero_shares, "dust": "0", "treasury_total": "0"}

    if outcome == "INVALID":
        return refund("INVALID_REFUND")
    if outcome not in ("YES", "NO"):
        raise ValueError("outcome must be YES, NO or INVALID")
    W, L = (yes, no) if outcome == "YES" else (no, yes)
    if W == 0 and L == 0:
        return refund("EMPTY")
    if W == 0:
        return refund("NO_WINNERS_REFUND")
    if L == 0:
        return refund("ONE_SIDED_REFUND")

    fee = L * fee_bps // 10000
    distributable = L - fee
    payouts, paid_profit = [], 0
    for side, a in stakes:
        if side == outcome:
            profit = a * distributable // W
            paid_profit += profit
            payouts.append(str(a + profit))
        else:
            payouts.append("0")
    dust = distributable - paid_profit
    shares = {r: fee * split[r] // 10000 for r in ROLES}
    treasury = fee - sum(shares.values()) + dust
    return {"case": "NORMAL", "payouts": payouts, "fee_total": str(fee),
            "fee_shares": {r: str(v) for r, v in shares.items()}, "dust": str(dust),
            "treasury_total": str(treasury)}
