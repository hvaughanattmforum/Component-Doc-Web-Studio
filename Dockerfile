# Hosted deployment image for ODA Studio (Component-Doc-Specification-Studio),
# replacing the pkg-built Windows .exe with a plain always-on Node service.
# See docker-entrypoint.sh for how REPO_ROOT gets populated on first start.

FROM node:22-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Vendor openpyxl into scripts/vendor/ (pure Python, no compiled deps) -
# reuses the same tool the desktop packaging pipeline already uses.
COPY tools/vendor-python.js tools/vendor-python.js
COPY scripts/requirements.txt scripts/requirements.txt
RUN node tools/vendor-python.js
COPY scripts scripts

# Build the React client.
COPY client/package.json client/package-lock.json client/
RUN npm --prefix client ci
COPY client client
RUN npm --prefix client run build


FROM node:22-slim
# python3 only (no pip) - the vendored openpyxl copied in below is self-contained.
# git is needed by docker-entrypoint.sh to clone the spec repo on first start.
# ca-certificates is needed for git to verify github.com's TLS cert over
# HTTPS - without it, every clone fails with "server certificate
# verification failed: CAfile: none CRLfile: none".
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY server/package.json server/package-lock.json server/
RUN npm --prefix server ci --omit=dev
COPY server/index.js server/index.js

COPY --from=build /app/scripts ./scripts
COPY --from=build /app/client/dist ./client/dist
# Pre-generated eTOM/SID/Functional Framework catalog JSON (see
# resolveDefaultFrameworksDir in server/index.js - this path, ./frameworks
# relative to WORKDIR, is one of its default search candidates, so no
# FRAMEWORKS_DIR env var is needed). Only the converted JSON is committed to
# the repo, never the source .xlsx spreadsheets (large, license-bearing) -
# see tools/copy-frameworks-catalogs.js for the same convention used by the
# desktop build.
COPY frameworks ./frameworks

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV PORT=4310
EXPOSE 4310
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
