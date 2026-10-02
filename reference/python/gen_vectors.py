"""Generate /vectors from the reference implementation.

Every value here is deterministic (ed25519 is deterministic; secp256k1 uses
RFC 6979), so regenerating must reproduce the committed files byte-for-byte.
CI enforces that. ALL KEYS BELOW ARE PUBLIC TEST KEYS. NEVER FUND THEM.
"""
import json
import pathlib
import sys

from amp.encoding import H, u8, hx
from amp.identity import agent_id, kid, pubkey_of, keybind_digest, sign
from amp.jcs import canonicalize
from amp.envelope import sign_envelope, signing_digest, envelope_hash, ZERO32
from amp.market import (canonical_spec_hash, instance_hash, market_id, deployment_id,
                        close_snapshot, position_leaf, merkle_root)
from amp.parimutuel import settle
from amp.oracle import sign_observation, evaluate
from amp.arbitration import run
from amp.forecast import commitment, brier_ppm2

OUT = pathlib.Path(__file__).resolve().parents[2] / "vectors"
DEPLOYMENT = "musepark-testnet"


def test_key(alg: str, i: int) -> bytes:
    return H("AMP/testkey/v1", alg.encode(), u8(i))


def keypair(alg, i):
    priv = test_key(alg, i)
    return priv, pubkey_of(alg, priv)


def dump(name, obj):
    p = OUT / name
    p.write_text(json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")


# --- fixtures ----------------------------------------------------------------
PROPOSER = keypair("ed25519", 1)
BANKR_LIKE = keypair("secp256k1", 2)
STAKER_B = keypair("ed25519", 3)
SOURCES = [keypair("ed25519", 10 + i) for i in range(3)]

SPEC = {
    "amp": "0.3",
    "question": "Will the TEST/USD feed print >= 100000.00 at 2026-12-31T00:00:00Z?",
    "rules": "Informative only. The oracle object is normative.",
    "close_ts": 1798588800,
    "oracle": {
        "kind": "numeric_threshold",
        "class": "A",
        "feed": "TEST/USD",
        "observation_ts": 1798675200,
        "finality_delay": 60,
        "publish_window": 3600,
        "sources": [{"alg": "ed25519", "pubkey": hx(pk)} for _, pk in SOURCES],
        "quorum": 2,
        "decimals": 2,
        "comparator": "gte",
        "threshold": "10000000",
    },
}
INSTANCE = {
    "rail": "eip155:31337",
    "collateral": "eip155:31337/erc20:0x0000000000000000000000000000000000000001",
    "creation_fee": "0",
    "fee_bps": 200,
    "fee_split_bps": {"proposer": 3000, "resolver": 3000, "settler": 1000, "treasury": 3000},
    "min_stake": "1000",
    "resolver_bond": "1000000",
    "resolve_window": 86400,
    "dispute_window": 7200,
    "max_rounds": 4,
    "reveal_window": 86400,
}
SALT = H("AMP/testsalt/v1", b"market-1")


def ident(kp, alg):
    return hx(agent_id(alg, kp[1])), hx(kid(alg, kp[1]))


def main():
    OUT.mkdir(exist_ok=True)

    # 1. JCS
    jcs_cases = [
        {"b": 1, "a": "x", "c": [True, False, None]},
        {"\u20ac": 1, "\r": 2, "\U0001f600": 3, "\ufb33": 4, "1": 5},
        {"s": "line\nbreak \"quoted\" back\\slash \u0007 bell \u2028"},
        {"amount": "340282366920938463463374607431768211455", "max_safe": 9007199254740991},
    ]
    dump("jcs.json", {"description": "RFC 8785 under the AMP profile (no floats, |int| <= 2^53-1).",
                      "cases": [{"input": c, "canonical_utf8_hex": canonicalize(c).hex(),
                                 "canonical": canonicalize(c).decode()} for c in jcs_cases],
                      "must_reject": [{"input_description": "float 0.5"},
                                      {"input_description": "integer 9007199254740992"}]})

    # 2. identity
    ids = []
    for alg, kp in (("ed25519", PROPOSER), ("secp256k1", BANKR_LIKE)):
        aid = agent_id(alg, kp[1])
        ids.append({"alg": alg, "test_private_key": hx(kp[0]), "pubkey": hx(kp[1]),
                    "kid": hx(kid(alg, kp[1])), "agent_id": hx(aid)})
    # key binding: proposer (root ed25519) binds a secp256k1 rail key
    root_aid = agent_id("ed25519", PROPOSER[1])
    rail_priv, rail_pub = keypair("secp256k1", 4)
    rail_kid = kid("secp256k1", rail_pub)
    kb = keybind_digest(root_aid, rail_kid, 1798500000)
    dump("identity.json", {"identities": ids, "key_bind": {
        "agent_id": hx(root_aid), "new_alg": "secp256k1", "new_pubkey": hx(rail_pub), "new_kid": hx(rail_kid),
        "valid_from": 1798500000, "keybind_digest": hx(kb), "cosig_by_new_key": hx(sign("secp256k1", rail_priv, kb))}})

    # 3. market id
    p_aid = agent_id("ed25519", PROPOSER[1])
    mid = market_id(DEPLOYMENT, SPEC, INSTANCE, p_aid, SALT)
    dump("market_id.json", {"deployment": DEPLOYMENT, "deployment_id": hx(deployment_id(DEPLOYMENT)),
                            "spec": SPEC, "instance": INSTANCE, "canonical_spec": canonicalize(SPEC).decode(),
                            "canonical_spec_hash": hx(canonical_spec_hash(SPEC)),
                            "canonical_instance": canonicalize(INSTANCE).decode(),
                            "instance_hash": hx(instance_hash(INSTANCE)), "proposer_agent_id": hx(p_aid),
                            "salt": hx(SALT), "market_id": hx(mid)})

    # 4. envelopes / signatures
    p_aid_h, p_kid = ident(PROPOSER, "ed25519")
    b_aid_h, b_kid = ident(BANKR_LIKE, "secp256k1")
    envs = []
    propose = {"type": "PROPOSE", "from": p_aid_h, "kid": p_kid, "market_id": hx(mid), "seq": 0,
               "expires_at": 1798000000, "body": {"spec": SPEC, "instance": INSTANCE, "salt": hx(SALT)}}
    position = {"type": "SUBMIT_POSITION", "from": b_aid_h, "kid": b_kid, "market_id": hx(mid), "seq": 1,
                "expires_at": 1798500000, "body": {"side": "YES", "amount": "5000000"}}
    cap = {"type": "CAPABILITY_AD", "from": b_aid_h, "kid": b_kid, "market_id": ZERO32, "seq": 7,
           "expires_at": 1798000000, "body": {"roles": ["settler", "resolver"], "rails": ["eip155:31337"]}}
    for env, alg, kp in ((propose, "ed25519", PROPOSER), (position, "secp256k1", BANKR_LIKE), (cap, "secp256k1", BANKR_LIKE)):
        signed = sign_envelope(env, DEPLOYMENT, alg, kp[0])
        envs.append({"alg": alg, "pubkey": hx(kp[1]), "envelope_hash": hx(envelope_hash(signed)),
                     "signing_digest": hx(signing_digest(signed, DEPLOYMENT)), "envelope": signed})
    dump("envelopes.json", {"deployment": DEPLOYMENT, "domain": f"AMP/0.3/{DEPLOYMENT}", "cases": envs})

    # 5. close snapshot / positions root
    s_aid = hx(agent_id("ed25519", STAKER_B[1]))
    positions = [{"agent_id": b_aid_h, "side": "YES", "amount": "5000000"},
                 {"agent_id": s_aid, "side": "NO", "amount": "3333333"},
                 {"agent_id": p_aid_h, "side": "YES", "amount": "1000"}]
    leaves = [hx(position_leaf(mid, i, bytes.fromhex(p["agent_id"]), p["side"], int(p["amount"])))
              for i, p in enumerate(positions)]
    dump("close.json", {"market_id": hx(mid), "positions": positions, "leaves": leaves,
                        "snapshot": close_snapshot(mid, positions),
                        "empty_root": hx(merkle_root([]))})

    # 6. pari-mutuel
    split = INSTANCE["fee_split_bps"]
    pm_cases = [
        ("normal_with_dust", [("YES", "5000000"), ("NO", "3333333"), ("YES", "1000")], "YES", 200),
        ("normal_no_wins", [("YES", "5000000"), ("NO", "3333333"), ("YES", "1000")], "NO", 200),
        ("no_winners_refund", [("NO", "700"), ("NO", "300")], "YES", 200),
        ("one_sided_refund", [("YES", "700"), ("YES", "300")], "YES", 200),
        ("empty", [], "YES", 200),
        ("invalid_refund", [("YES", "10"), ("NO", "20")], "INVALID", 200),
        ("three_way_dust", [("YES", "1"), ("YES", "1"), ("YES", "1"), ("NO", "10")], "YES", 0),
        ("max_fee", [("YES", "100"), ("NO", "100")], "YES", 10000),
    ]
    dump("parimutuel.json", {"fee_split_bps": split, "cases": [
        {"name": n, "fee_bps": fb, "outcome": oc, "positions": [{"side": s, "amount": a} for s, a in ps],
         "result": settle([{"side": s, "amount": a} for s, a in ps], oc, fb, split)}
        for n, ps, oc, fb in pm_cases]})

    # 7. oracle + arbitration
    o = SPEC["oracle"]
    sid = [hx(kid("ed25519", pk)) for _, pk in SOURCES]
    T = o["observation_ts"]

    def obs(i, value, published):
        return sign_observation("numeric_threshold", {"source_id": sid[i], "feed": "TEST/USD", "observation_ts": T,
                                                      "published_ts": published, "value": value}, "ed25519", SOURCES[i][0])

    o0 = obs(0, "10050000", T + 120)
    o1 = obs(1, "9990000", T + 90)
    o2 = obs(2, "10001000", T + 100)
    o2_equiv = obs(2, "9000000", T + 100)
    o0_later = obs(0, "1", T + 600)          # later revision: ignored by earliest-eligible rule
    o1_early = obs(1, "10100000", T + 61)   # earlier eligible print from source 1
    too_early = obs(0, "1", T + 10)          # before finality_delay: invalid
    forged = dict(o1, value="99999999")      # signature no longer matches

    oracle_cases = [
        ("all_three_yes_median", [o0, o1, o2]),
        ("quorum_not_met", [o0]),
        ("later_revision_ignored", [o0, o0_later, o1]),
        ("earlier_print_wins", [o0, o1, o1_early]),
        ("equivocation_drops_source", [o1, o2, o2_equiv]),
        ("invalid_obs_ignored", [too_early, forged, o2]),
    ]
    dump("oracle.json", {"oracle": o, "source_ids": sid, "cases": [
        {"name": n, "evidence": ev, "result": evaluate(o, ev)} for n, ev in oracle_cases]})

    earliest = T + o["finality_delay"] + o["publish_window"]
    res_a = "a" * 64
    res_b = "b" * 64
    res_c = "c" * 64
    games = {
        "uncontested": ([{"kind": "RESOLVE", "claimant": res_a, "outcome": "NO", "evidence": [o1, o2], "bond": "1000000", "ts": earliest + 10}],
                        earliest + 10 + 7200),
        "dispute_flips_with_withheld_evidence": (
            [{"kind": "RESOLVE", "claimant": res_a, "outcome": "NO", "evidence": [o1, o2], "bond": "1000000", "ts": earliest + 10},
             {"kind": "DISPUTE", "claimant": res_b, "outcome": "YES", "evidence": [o1_early], "bond": "2000000", "ts": earliest + 100}],
            earliest + 100 + 7200),
        "dispute_rejected_no_change": (
            [{"kind": "RESOLVE", "claimant": res_a, "outcome": "YES", "evidence": [o0, o1, o2], "bond": "1000000", "ts": earliest + 10},
             {"kind": "DISPUTE", "claimant": res_b, "outcome": "NO", "evidence": [o0_later], "bond": "2000000", "ts": earliest + 20}],
            earliest + 10 + 7200),
        "resolve_too_early_then_valid": (
            [{"kind": "RESOLVE", "claimant": res_a, "outcome": "YES", "evidence": [o0, o2], "bond": "1000000", "ts": earliest - 1},
             {"kind": "RESOLVE", "claimant": res_c, "outcome": "YES", "evidence": [o0, o2], "bond": "1000000", "ts": earliest}],
            earliest + 7200),
        "no_resolution": ([], earliest + INSTANCE["resolve_window"]),
        "settle_too_early": ([{"kind": "RESOLVE", "claimant": res_a, "outcome": "NO", "evidence": [o1, o2], "bond": "1000000", "ts": earliest + 10}],
                             earliest + 10 + 7199),
    }
    dump("arbitration.json", {"spec": SPEC, "instance": INSTANCE, "cases": [
        {"name": n, "events": evs, "settle_ts": st, "result": run(SPEC, INSTANCE, evs, st)}
        for n, (evs, st) in games.items()]})

    # 8. forecasts
    fsalt = H("AMP/testsalt/v1", b"forecast-1")
    dump("forecast.json", {"market_id": hx(mid), "agent_id": b_aid_h, "salt": hx(fsalt), "cases": [
        {"p_ppm": p, "commitment": hx(commitment(mid, bytes.fromhex(b_aid_h), p, fsalt)),
         "brier_ppm2_if_YES": brier_ppm2(p, "YES"), "brier_ppm2_if_NO": brier_ppm2(p, "NO")}
        for p in (0, 1, 500000, 730000, 999999, 1000000)]})


if __name__ == "__main__":
    sys.exit(main())
