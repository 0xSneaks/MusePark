import copy
import json
import pathlib
import random

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

import gen_vectors
from amp import jcs
from amp.encoding import amount, signed_int, unhex, hx
from amp.envelope import sign_envelope, verify_envelope, SeqTracker, signing_digest
from amp.identity import sign, verify, SECP256K1_N
from amp.market import validate_spec, validate_instance, SpecError, merkle_root, market_id
from amp.oracle import evaluate
from amp.parimutuel import settle
from amp.arbitration import run
from amp.forecast import commitment, brier_ppm2

ROOT = pathlib.Path(__file__).resolve().parents[3]
VEC = ROOT / "vectors"
SCHEMAS = ROOT / "schemas"


def load(name):
    return json.loads((VEC / name).read_text(encoding="utf-8"))


# --- vectors are reproducible -------------------------------------------------

def test_vectors_reproduce_byte_for_byte(tmp_path, monkeypatch):
    monkeypatch.setattr(gen_vectors, "OUT", tmp_path)
    gen_vectors.main()
    committed = sorted(p.name for p in VEC.glob("*.json"))
    assert committed == sorted(p.name for p in tmp_path.glob("*.json"))
    for name in committed:
        assert (tmp_path / name).read_bytes() == (VEC / name).read_bytes(), name


# --- JCS ----------------------------------------------------------------------

def test_jcs_vectors():
    for c in load("jcs.json")["cases"]:
        assert jcs.canonicalize(c["input"]).hex() == c["canonical_utf8_hex"]


@pytest.mark.parametrize("bad", [0.5, 1.0, 2**53, -(2**53), {"a": float("nan")}, "\ud800", {1: 2}])
def test_jcs_rejects(bad):
    with pytest.raises(jcs.CanonicalizationError):
        jcs.canonicalize(bad)


def test_jcs_utf16_key_order():
    # U+FB33 (BMP) sorts after U+1F600 in UTF-16 (surrogate D83D) but before it by code point.
    out = jcs.canonicalize({"\ufb33": 1, "\U0001f600": 2}).decode()
    assert out.index("\U0001f600") < out.index("\ufb33")


@pytest.mark.parametrize("s", ["01", "-1", "1.0", " 1", "", "1e3", str(2**128)])
def test_amount_rejects(s):
    with pytest.raises(ValueError):
        amount(s)


@pytest.mark.parametrize("s", ["-0", "01", "+1", str(2**127)])
def test_signed_int_rejects(s):
    with pytest.raises(ValueError):
        signed_int(s)


# --- signatures -----------------------------------------------------------------

def test_envelope_vectors_verify_and_tamper_fails():
    v = load("envelopes.json")
    for c in v["cases"]:
        env, pk = c["envelope"], unhex(c["pubkey"])
        assert hx(signing_digest(env, v["deployment"])) == c["signing_digest"]
        assert verify_envelope(env, v["deployment"], c["alg"], pk)
        # wrong deployment (domain separation)
        assert not verify_envelope(env, "musepark-mainnet", c["alg"], pk)
        # any body change breaks it
        t = copy.deepcopy(env)
        t["seq"] += 1
        assert not verify_envelope(t, v["deployment"], c["alg"], pk)
        # type confusion breaks it
        t = copy.deepcopy(env)
        t["type"] = "CLAIM_ROLE" if env["type"] != "CLAIM_ROLE" else "PROPOSE"
        assert not verify_envelope(t, v["deployment"], c["alg"], pk)


def test_secp256k1_high_s_rejected():
    priv = gen_vectors.test_key("secp256k1", 2)
    pk = gen_vectors.pubkey_of("secp256k1", priv)
    d = bytes(32)
    sig = sign("secp256k1", priv, d)
    assert verify("secp256k1", pk, d, sig)
    s = int.from_bytes(sig[32:64], "big")
    high = sig[:32] + (SECP256K1_N - s).to_bytes(32, "big") + bytes([sig[64] ^ 1])
    assert not verify("secp256k1", pk, d, high)


def test_seq_replay_and_expiry():
    t = SeqTracker()
    e = {"from": "a", "market_id": "m", "seq": 5, "expires_at": 100}
    assert t.accept(e, 50)
    assert not t.accept(e, 50)                       # replay
    assert not t.accept({**e, "seq": 4}, 50)         # lower seq
    assert t.accept({**e, "market_id": "n"}, 50)     # different scope
    assert not t.accept({**e, "seq": 6}, 101)        # expired


def test_keybind_cosig_verifies():
    kb = load("identity.json")["key_bind"]
    assert verify(kb["new_alg"], unhex(kb["new_pubkey"]), unhex(kb["keybind_digest"]), unhex(kb["cosig_by_new_key"]))


# --- market spec / id ------------------------------------------------------------

def test_market_id_vector():
    v = load("market_id.json")
    mid = market_id(v["deployment"], v["spec"], v["instance"], unhex(v["proposer_agent_id"]), unhex(v["salt"]))
    assert hx(mid) == v["market_id"]


def test_market_id_binds_every_input():
    v = load("market_id.json")
    args = (v["deployment"], v["spec"], v["instance"], unhex(v["proposer_agent_id"]), unhex(v["salt"]))
    base = market_id(*args)
    s2 = copy.deepcopy(v["spec"]); s2["close_ts"] -= 1
    i2 = copy.deepcopy(v["instance"]); i2["fee_bps"] += 1
    variants = [("musepark-x",) + args[1:], (args[0], s2) + args[2:], args[:2] + (i2,) + args[3:],
                args[:3] + (bytes(32), args[4]), args[:4] + (bytes(32),)]
    assert len({market_id(*a) for a in variants} | {base}) == 6


@pytest.mark.parametrize("mutate,msg", [
    (lambda s: s.update(close_ts=s["oracle"]["observation_ts"] + 1), "close_ts"),
    (lambda s: s["oracle"].update(quorum=4), "quorum"),
    (lambda s: s["oracle"].update(threshold="1.5"), "integer"),
    (lambda s: s["oracle"]["sources"].append(dict(s["oracle"]["sources"][0])), "duplicate"),
    (lambda s: s.update(extra=1), "keys"),
])
def test_spec_validation(mutate, msg):
    s = copy.deepcopy(gen_vectors.SPEC)
    mutate(s)
    with pytest.raises((SpecError, ValueError)):
        validate_spec(s)


def test_boolean_quorum_must_be_majority():
    s = copy.deepcopy(gen_vectors.SPEC)
    o = s["oracle"]
    for k in ("decimals", "comparator", "threshold"):
        del o[k]
    o["kind"] = "boolean_attestation"
    o["quorum"] = 1
    with pytest.raises(SpecError):
        validate_spec(s)
    o["quorum"] = 2
    validate_spec(s)


def test_fee_split_must_sum():
    i = copy.deepcopy(gen_vectors.INSTANCE)
    i["fee_split_bps"]["treasury"] -= 1
    with pytest.raises(SpecError):
        validate_instance(i)


def test_merkle_odd_node_not_duplicated():
    a, b, c = (bytes([i]) * 32 for i in (1, 2, 3))
    assert merkle_root([a, b, c]) != merkle_root([a, b, c, c])


# --- pari-mutuel ----------------------------------------------------------------

def test_parimutuel_vectors():
    v = load("parimutuel.json")
    for c in v["cases"]:
        assert settle(c["positions"], c["outcome"], c["fee_bps"], v["fee_split_bps"]) == c["result"]


def test_parimutuel_conservation_fuzz():
    rng = random.Random(1337)
    split = gen_vectors.INSTANCE["fee_split_bps"]
    for _ in range(3000):
        n = rng.randint(0, 12)
        pos = [{"side": rng.choice(["YES", "NO"]), "amount": str(rng.choice([1, 7, 10**6, rng.randint(1, 10**30)]))}
               for _ in range(n)]
        outcome = rng.choice(["YES", "NO", "INVALID"])
        r = settle(pos, outcome, rng.randint(0, 10000), split)
        total_in = sum(int(p["amount"]) for p in pos)
        out = sum(map(int, r["payouts"])) + sum(map(int, r["fee_shares"].values())) + int(r["treasury_total"])
        assert out == total_in
        if r["case"] == "NORMAL":
            for p, pay in zip(pos, r["payouts"]):
                if p["side"] == outcome:
                    assert int(pay) >= int(p["amount"])   # winners never net-lose
                else:
                    assert pay == "0"


# --- oracle / arbitration ---------------------------------------------------------

def test_oracle_vectors_and_order_independence():
    v = load("oracle.json")
    rng = random.Random(7)
    for c in v["cases"]:
        assert evaluate(v["oracle"], c["evidence"]) == c["result"], c["name"]
        ev = list(c["evidence"])
        for _ in range(5):
            rng.shuffle(ev)
            assert evaluate(v["oracle"], ev) == c["result"]


def test_arbitration_vectors():
    v = load("arbitration.json")
    for c in v["cases"]:
        assert run(v["spec"], v["instance"], c["events"], c["settle_ts"]) == c["result"], c["name"]


def _game():
    v = load("arbitration.json")
    case = next(c for c in v["cases"] if c["name"] == "dispute_flips_with_withheld_evidence")
    return v["spec"], v["instance"], copy.deepcopy(case["events"]), case["settle_ts"]


def test_dispute_bond_too_low_rejected():
    spec, inst, ev, st = _game()
    ev[1]["bond"] = "1999999"
    r = run(spec, inst, ev, st)
    assert r["outcome"] == "NO" and r["log"][1]["why"] == "BOND_TOO_LOW"


def test_dispute_after_window_rejected():
    spec, inst, ev, st = _game()
    ev[1]["ts"] = ev[0]["ts"] + inst["dispute_window"]
    r = run(spec, inst, ev, max(st, ev[1]["ts"] + inst["dispute_window"]))
    assert r["log"][1]["why"] == "WINDOW_CLOSED"


def test_claim_must_equal_f():
    spec, inst, ev, st = _game()
    ev[0]["outcome"] = "YES"   # evidence says NO
    r = run(spec, inst, ev[:1], st)
    assert r["log"][0]["why"] == "CLAIM_NOT_EQUAL_F"
    assert not r["settled"]  # still inside resolve_window; nobody has resolved


def test_round_cap_invalidates_and_refunds():
    spec, inst, ev, st = _game()
    inst = dict(inst, max_rounds=1)
    r = run(spec, inst, ev, st)
    assert r["outcome"] == "INVALID" and r["reason"] == "ROUND_CAP"
    assert r["bond_returns"] == ["1000000", "2000000"]


# --- forecasts ---------------------------------------------------------------------

def test_forecast_vectors():
    v = load("forecast.json")
    for c in v["cases"]:
        assert hx(commitment(unhex(v["market_id"]), unhex(v["agent_id"]), c["p_ppm"], unhex(v["salt"]))) == c["commitment"]
        assert brier_ppm2(c["p_ppm"], "YES") == c["brier_ppm2_if_YES"]


@pytest.mark.parametrize("p", [-1, 1_000_001, 0.5, True])
def test_forecast_rejects_bad_probability(p):
    with pytest.raises(ValueError):
        commitment(bytes(32), bytes(32), p, bytes(32))


# --- schemas -----------------------------------------------------------------------

def _registry():
    res = []
    for p in SCHEMAS.glob("*.json"):
        s = json.loads(p.read_text())
        res.append((s["$id"], Resource.from_contents(s)))
    return Registry().with_resources(res)


def _validator(name):
    s = json.loads((SCHEMAS / name).read_text())
    Draft202012Validator.check_schema(s)
    return Draft202012Validator(s, registry=_registry())


def test_schemas_accept_vectors():
    env_v = _validator("envelope.schema.json")
    for c in load("envelopes.json")["cases"]:
        env_v.validate(c["envelope"])
    _validator("market_spec.schema.json").validate(gen_vectors.SPEC)
    _validator("market_instance.schema.json").validate(gen_vectors.INSTANCE)
    obs_v = _validator("observation.schema.json")
    for c in load("oracle.json")["cases"]:
        for o in c["evidence"]:
            obs_v.validate(o)


def test_schema_rejects_float_amount_and_unknown_field():
    env_v = _validator("envelope.schema.json")
    c = copy.deepcopy(load("envelopes.json")["cases"][1]["envelope"])
    c["body"]["amount"] = 5.0
    assert not env_v.is_valid(c)
    c = copy.deepcopy(load("envelopes.json")["cases"][1]["envelope"])
    c["body"]["leverage"] = "10"
    assert not env_v.is_valid(c)
