# Contributing to VIBE Hyderabad

## Branches

| Branch | Purpose | Deploys to | Who merges |
| --- | --- | --- | --- |
| `main` | **Production.** Always releasable. Every commit here is a release. | Production | Release or hotfix PRs only |
| `develop` | **Development / integration.** Finished features land here first. | Development / staging | Feature, bugfix and release PRs |
| `feature/<short-name>` | New functionality | — | PR into `develop` |
| `bugfix/<short-name>` | Fix for a bug found in `develop` (not yet in production) | — | PR into `develop` |
| `hotfix/<short-name>` | Urgent fix for a bug **in production** | — | PR into `main`, then merge `main` back into `develop` |
| `release/<version>` | Freeze for testing before a production release | Staging | PR into `main`, then back into `develop` |
| `chore/<short-name>`, `docs/<short-name>` | Tooling, CI, dependencies, documentation | — | PR into `develop` |

Never commit directly to `main` or `develop`. Use lower-case kebab-case names, e.g. `feature/merchant-dashboard`, `bugfix/otp-resend-timer`, `hotfix/payment-status-poll`.

### Everyday flow

```bash
git switch develop && git pull
git switch -c feature/merchant-dashboard
# ...work, commit...
git push -u origin feature/merchant-dashboard
# open a PR into develop
```

### Production hotfix

```bash
git switch main && git pull
git switch -c hotfix/payment-status-poll
# ...fix, commit...
git push -u origin hotfix/payment-status-poll
# PR into main → merge → tag the release → merge main back into develop
```

### Release

```bash
git switch develop && git pull
git switch -c release/1.1.0
# only fixes and version bumps on this branch
# PR into main → merge → tag v1.1.0 → merge main back into develop
```

Tag every production release on `main` as `vMAJOR.MINOR.PATCH` (semantic versioning): breaking change → MAJOR, new feature → MINOR, fix → PATCH.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/) so history and changelogs stay readable:

```
feat(social): add one-on-one meetup invites
fix(payments): stop polling after verification
hotfix(payments): handle provider timeout on status check
chore(ci): run tests on pull requests
docs: explain branch model
```

Types: `feat`, `fix`, `hotfix`, `perf`, `refactor`, `test`, `docs`, `chore`, `ci`, `build`. Scope is the module (`customer`, `merchant`, `admin`, `backend`, `payments`, `social`, …).

## Pull requests

- Keep PRs focused on one change. Fill in the PR template.
- CI must pass: typecheck, lint and tests.
- At least one review before merging into `develop`; two for `main`.
- Never put secrets, API keys or real customer data in code, commits or PRs. Use `.env` files (git-ignored) and the provider's secret store.

## Local checks (customer app)

```bash
cd apps/customer
npm ci
npm run typecheck
npm run lint
npm test
```
