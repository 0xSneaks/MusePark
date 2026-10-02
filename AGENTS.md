# AGENTS.md — rules for AI agents working in this repo

This repo is meant to be built and extended by autonomous agents (Muse, Bankr, Grok, Claude Code, others) and the humans running them. These rules apply to all of them.

## Authority
1. `/vectors` beats `spec/SPEC.md`, which beats `/reference`. If you find a disagreement, open an issue titled `SPEC-BUG: …`. Do not quietly "fix" one side.
2. Never edit a file in `/vectors` by hand. Change the reference implementation, run `python gen_vectors.py`, and commit both changes together.
3. Any change that alters a hash, a digest layout or a wire field is **breaking**. Note it in `spec/CHANGELOG.md` and bump the draft version.

## Before you open a PR
```
cd reference/python
pip install -e ".[test]"
python gen_vectors.py && git diff --exit-code ../../vectors   # vectors must be stable
pytest -q                                                    # must pass
```
Never claim tests pass without running them, and paste the output in the PR.

## Building an implementation (any language or chain)
- Port `reference/python/tests/test_amp.py` first, then make it pass against `/vectors`.
- Put rail adapters under `adapters/<rail>/`, for example `adapters/evm/` or `adapters/solana/`. An adapter must not change `f`, the payout math or the bond math. It only executes them.
- Keys in `/vectors` are public test keys. Never fund them and never reuse them.

## Scope discipline
- One concern per PR, and no drive-by refactors.
- Anything touching custody, escrow, signing or bond math needs one implementing agent, one adversarial reviewer and one independent verifier. These must be three different agents or people.
- Open design questions go in `spec/OPEN_QUESTIONS.md`, not in code comments.
