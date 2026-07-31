# ODA Web Studio

A web app for creating and editing TMForum ODA component (`TMFCxxx`) specifications
in the [WebSpecDemoData](https://github.com/hvaughanattmforum/WebSpecDemoData)
repository. Multiple signed-in GitHub users can use it at once; each user's
edits land as their own pull request rather than being written straight to
the repo.

The app is an Express server (`server/`) plus a React/Vite client
(`client/`), served together as one process.

## Signing in (for users of the hosted app)

Before you start, you need a GitHub account. The specification repository
[`WebSpecDemoData`](https://github.com/hvaughanattmforum/WebSpecDemoData) is
public, so anyone signed in can read it - but saving your work pushes a
branch and opens a pull request, which needs you to be a **collaborator** on
that repository. If you're not sure whether you have that, ask whoever
manages the `hvaughanattmforum` account.

1. **Open the app** at <https://componentspecstudio.crowdframe.global>.
2. **Click "Sign in with GitHub"**, near the top right of the page.
3. **Log in to GitHub** if your browser isn't already signed in - same
   username/password (and two-factor step, if you have it) you'd use at
   github.com directly. You're never asked to type your GitHub password into
   this app itself, only into GitHub's own page.
4. **Review and approve access.** GitHub shows a page titled something like
   "Authorize [app name]", listing exactly what the app is asking permission
   to do on your behalf - typically access to your repositories (to read
   specification files and open pull requests for you) and your basic
   profile info (name and avatar). Clicking the green **Authorize** button
   allows the app to act using *your own* GitHub account and permissions -
   not a shared account. Every change the app makes in GitHub happens under
   your name, exactly as if you'd made it by hand.
5. **You're in.** You'll be redirected back to the app, now showing your
   name and GitHub avatar in the top right, with a **Sign out** button next
   to it.

The first time you load or create a component, the app sets up your own
private workspace behind the scenes - this can take a few seconds. Any
changes you save are proposed as a **pull request** under your GitHub
username, not committed directly - someone reviews it before it's merged,
same as a normal GitHub workflow.

If saving fails with a permissions error, that usually means your GitHub
account isn't a collaborator on the specification repository yet - reading
works for anyone, but pushing a branch does not.

## Local development

```
npm --prefix server install
npm --prefix client install
npm --prefix server start    # http://localhost:4310 (API)
npm --prefix client run dev  # http://localhost:4320 (client, proxies /api to :4310 - see client/vite.config.js)
```

Open `http://localhost:4320`. GitHub sign-in requires an OAuth App - see
"Configuration" below.

### Single-checkout mode (no per-user workspaces)

Leaving `SPEC_REPO_URL` unset makes the server behave like a single-user
tool against one local checkout, same as the original desktop app - useful
for quick local testing without exercising the per-session clone/PR flow:

```
REPO_ROOT=/path/to/your/WebSpecDemoData/checkout npm --prefix server start
```

`POST /api/save` still writes straight to that checkout in this mode; no
branch/commit/PR happens.

## Configuration (environment variables)

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | no (default `4310`) | Port the server listens on |
| `SESSION_SECRET` | yes in production | Signs the session cookie |
| `ALLOWED_ORIGIN` | no | Locks CORS to this origin; unset reflects any origin (fine for local dev) |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | yes | From a GitHub OAuth App - see below |
| `GITHUB_CALLBACK_URL` | no (default `http://localhost:<PORT>/auth/github/callback`) | Must exactly match the OAuth App's callback URL |
| `SPEC_REPO_URL` | yes, for per-user workspaces | Git URL of the ODA spec repo each signed-in user gets their own clone of |
| `SPEC_REPO_BRANCH` | no (default `main`) | Base branch new session branches/PRs are created from |
| `REPO_ROOT` | no | Legacy single-checkout fallback (see above) - ignored once `SPEC_REPO_URL` is set |
| `FRAMEWORKS_DIR` | no | Directory of pre-generated eTOM/SID/Functional Framework catalog JSON (shared, not per-user) |

### GitHub OAuth App

Create one at <https://github.com/settings/developers> → New OAuth App:
- Homepage URL: wherever the app is reachable (e.g. `http://localhost:4310`)
- Authorization callback URL: must exactly match `GITHUB_CALLBACK_URL` (or its default)

The `repo` scope is requested at sign-in so the server can push a user's
session branch and open a PR on their behalf.

## Hosted deployment

For Amazon ECS Express Mode (recommended - lowest ops overhead for this
app's single-instance constraint; see [`infra/terraform/README.md`](infra/terraform/README.md)
for why this replaced an earlier AWS App Runner scaffold), see
[`infra/terraform/`](infra/terraform/README.md), which provisions ECR, the
ECS Express service pinned to one task, the Secrets Manager entries, and a
GitHub Actions OIDC deploy role.

To build and run the Docker image directly (Node + Python3 + the built
client baked in - see [`Dockerfile`](Dockerfile)):

```
docker build -t oda-web-studio .
docker run -p 4310:4310 \
  -e SESSION_SECRET=... -e GITHUB_CLIENT_ID=... -e GITHUB_CLIENT_SECRET=... \
  -e SPEC_REPO_URL=https://github.com/hvaughanattmforum/WebSpecDemoData.git \
  oda-web-studio
```

For single-checkout mode (no per-user workspaces) inside a container, set
`REPO_ROOT` to a mounted volume path and leave the app's `SPEC_REPO_URL`
unset; [`docker-entrypoint.sh`](docker-entrypoint.sh) will clone into that
empty volume on first start if you also set `INITIAL_REPO_CLONE_URL` (and
optionally `INITIAL_REPO_CLONE_BRANCH`) - deliberately separate variables
from the app's own `SPEC_REPO_URL`/`SPEC_REPO_BRANCH` above, so turning one
mode on doesn't accidentally also turn on the other.

## Legacy: Windows desktop build

`npm run dist` (root `package.json`) still builds the old single-user
Windows `.exe` + installer - see [`installer/README.md`](installer/README.md).
This is no longer how the app is deployed; it's kept working only in case a
desktop build is still wanted.
