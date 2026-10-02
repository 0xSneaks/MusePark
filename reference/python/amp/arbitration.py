"""Deterministic resolution / dispute game (spec section 10).

There is no voting and no human arbiter. Every claim must equal f() over the
evidence known at the time of the claim, and a DISPUTE is admissible only if it
adds evidence that changes f(). Disputes therefore surface withheld evidence;
they can never argue.
"""
from .encoding import amount
from .oracle import evaluate


def _obs_key(o):
    return (o["source_id"], o["feed"], o["observation_ts"], o["published_ts"], str(o["value"]), o["sig"])


def run(spec: dict, instance: dict, events: list[dict], settle_ts: int) -> dict:
    """events: anchored RESOLVE/DISPUTE actions in anchoring order, each
    {kind, claimant, outcome, evidence, bond, ts}. Returns the final state."""
    o = spec["oracle"]
    earliest = o["observation_ts"] + o["finality_delay"] + o["publish_window"]
    earliest = max(earliest, spec["close_ts"])
    deadline = earliest + instance["resolve_window"]
    base_bond = amount(instance["resolver_bond"])
    window = instance["dispute_window"]

    evidence, seen = [], set()
    claims, log = [], []
    current = None  # (outcome, reason)
    last_ts = None
    capped = False

    def merged(new):
        out = list(evidence)
        keys = set(seen)
        for ob in new:
            k = _obs_key(ob)
            if k not in keys:
                keys.add(k)
                out.append(ob)
        return out, keys

    for ev in events:
        ts, bond = ev["ts"], amount(ev["bond"])
        if ts >= settle_ts or capped:
            log.append({"kind": ev["kind"], "accepted": False, "why": "AFTER_SETTLE_OR_CAPPED"})
            continue
        if ev["kind"] == "RESOLVE":
            if current is not None:
                why = "ALREADY_RESOLVED"
            elif not earliest <= ts < deadline:
                why = "OUTSIDE_RESOLVE_WINDOW"
            elif bond < base_bond:
                why = "BOND_TOO_LOW"
            else:
                cand, keys = merged(ev["evidence"])
                r = evaluate(o, cand)
                if r["outcome"] != ev["outcome"]:
                    why = "CLAIM_NOT_EQUAL_F"
                else:
                    evidence, seen = cand, keys
                    current, last_ts = (r["outcome"], r["reason"]), ts
                    claims.append({"claimant": ev["claimant"], "outcome": r["outcome"], "bond": bond, "ts": ts})
                    log.append({"kind": "RESOLVE", "accepted": True, "outcome": r["outcome"]})
                    continue
            log.append({"kind": "RESOLVE", "accepted": False, "why": why})
        elif ev["kind"] == "DISPUTE":
            rnd = len(claims)  # 1-based round number of this dispute
            if current is None:
                why = "NOTHING_TO_DISPUTE"
            elif ts >= last_ts + window:
                why = "WINDOW_CLOSED"
            elif bond < base_bond * (2 ** rnd):
                why = "BOND_TOO_LOW"
            else:
                cand, keys = merged(ev["evidence"])
                r = evaluate(o, cand)
                if r["outcome"] == current[0]:
                    why = "DOES_NOT_CHANGE_F"
                elif r["outcome"] != ev["outcome"]:
                    why = "CLAIM_NOT_EQUAL_F"
                else:
                    evidence, seen = cand, keys
                    current, last_ts = (r["outcome"], r["reason"]), ts
                    claims.append({"claimant": ev["claimant"], "outcome": r["outcome"], "bond": bond, "ts": ts})
                    log.append({"kind": "DISPUTE", "accepted": True, "round": rnd, "outcome": r["outcome"]})
                    if rnd >= instance["max_rounds"]:
                        capped = True
                    continue
            log.append({"kind": "DISPUTE", "accepted": False, "why": why})
        else:
            raise ValueError("unknown event kind")

    # --- finality -------------------------------------------------------------
    if capped:
        final, reason = "INVALID", "ROUND_CAP"
        if settle_ts < last_ts:
            return {"settled": False, "why": "TOO_EARLY", "log": log}
    elif current is None:
        if settle_ts < deadline:
            return {"settled": False, "why": "TOO_EARLY", "log": log}
        final, reason = "INVALID", "NO_RESOLUTION"
    else:
        if settle_ts < last_ts + window:
            return {"settled": False, "why": "TOO_EARLY", "log": log}
        final, reason = current

    return {"settled": True, "outcome": final, "reason": reason, "log": log,
            **slash(claims, final, reason)}


def slash(claims: list[dict], final: str, reason: str) -> dict:
    """Bond accounting. ROUND_CAP / NO_RESOLUTION refund every bond. Otherwise
    claims equal to the final outcome are refunded and split 50% of slashed
    bonds pro-rata by bond; the other 50% plus rounding dust go to treasury."""
    if reason in ("ROUND_CAP", "NO_RESOLUTION"):
        return {"bond_returns": [str(c["bond"]) for c in claims], "treasury_from_slash": "0",
                "resolution_fee_recipient": None}
    right = [c for c in claims if c["outcome"] == final]
    slashed = sum(c["bond"] for c in claims if c["outcome"] != final)
    reward_pool = slashed // 2
    right_total = sum(c["bond"] for c in right)
    returns, paid = [], 0
    for c in claims:
        if c["outcome"] == final:
            r = reward_pool * c["bond"] // right_total if right_total else 0
            paid += r
            returns.append(str(c["bond"] + r))
        else:
            returns.append("0")
    treasury = slashed - paid
    recipient = right[0]["claimant"] if right and final in ("YES", "NO") else None
    return {"bond_returns": returns, "treasury_from_slash": str(treasury),
            "resolution_fee_recipient": recipient}
