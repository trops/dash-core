# Dash checks

Deterministic checks the Dash Code Factory's bots run on their work in this
repo (repo checks, DASH-102), the same commands this repo's CI runs:

- `setup`: installs what the repo needs.
- `validate`: what CI checks.

Bots use them by name (`{ kind: "repo", name: "validate" }`), read from the
base branch, so a branch can't change the check that judges it. By hand:

```sh
npx -p @trops/dash-core dash-check --list
npx -p @trops/dash-core dash-check validate
```

How to write one: `get_setup_guide({ topic: "checks" })` or the
`dash-check-authoring` skill.

dash-core also has `ci-test-list`: every `node:test` file runs in CI
(DASH-158). jest skips `electron/` and `scripts/`, so `scripts/ci.sh` runs
every `node:test` file it finds with `scripts/listNodeTests.js`, no list to
keep. A file that can't pass yet is quarantined in `ci-test-list.known.txt`
with its Jira bug (`path  # DASH-<n>: why`); the check fails on one without.
`scripts/ci.sh` runs the check too, so CI and the bots agree.
