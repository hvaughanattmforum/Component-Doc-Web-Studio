#!/bin/sh
# Single-checkout mode only (REPO_ROOT set, SPEC_REPO_URL unset - see
# README.md): clones the ODA spec repo into REPO_ROOT on first start, so a
# fresh deployment (empty volume) becomes usable without a manual clone step.
# No-op if REPO_ROOT already looks like a git checkout (e.g. on redeploy with
# a persisted volume) or if INITIAL_REPO_CLONE_URL isn't set.
#
# Deliberately a DIFFERENT variable from the app's own SPEC_REPO_URL
# (server/index.js's per-signed-in-user workspace cloning) - reusing that
# name here would silently turn on per-user cloning too, which is the
# opposite of what single-checkout mode is for.
set -e

if [ -n "$INITIAL_REPO_CLONE_URL" ] && [ -n "$REPO_ROOT" ] && [ ! -d "$REPO_ROOT/.git" ]; then
  echo "Cloning $INITIAL_REPO_CLONE_URL into $REPO_ROOT (branch: ${INITIAL_REPO_CLONE_BRANCH:-main})..."
  git clone --branch "${INITIAL_REPO_CLONE_BRANCH:-main}" "$INITIAL_REPO_CLONE_URL" "$REPO_ROOT"
fi

exec "$@"
