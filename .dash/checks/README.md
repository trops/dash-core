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

dash-core also has `ci-test-list`: every `node:test` file is in
`scripts/ci.sh`'s lists (jest skips `electron/` and `scripts/`, so one that
isn't named there never runs). `scripts/ci.sh` runs it too, so CI and the
bots agree. Files that were already missing are in `ci-test-list.known.txt`.
