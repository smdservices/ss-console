# SMD AI Employee — customer-shape Hermes container
#
# Builds Hermes from upstream at a pinned ref, installs the hermes-smd
# overlay plugins + companion CLI, layers in our AIEmployee adapter / skill
# library / connectors / safety-substrate tests, and bundles Postgres + Redis
# + Honcho (Plastic Labs, AGPL-3.0) as in-container memory infrastructure.
#
# The container runs a multi-process startup under tini (PID 1, zombie
# reaper). bootstrap.sh launches Postgres, Redis, Honcho, the customer-sync
# sidecar, and finally execs Hermes. See bootstrap.sh for the full sequence.
#
# Per §6 of the locked build plan and ADR 0019: customer.yaml is NOT baked
# into the image. Provisioning writes it to R2 at vaults/<slug>/customer.yaml;
# bootstrap.sh fetches it to /opt/data/customer.yaml on first boot.
#
# Per-customer build context expects:
#   - ai-employee/adapter/         (AIEmployee adapter — Python)
#   - ai-employee/skills/          (canonical skill library — markdown)
#   - ai-employee/connectors/      (Tier-1 custom MCP wrappers)
#   - ai-employee/safety-substrate/ (Phase A.5 invariant fixtures + runner)
#   - ai-employee/templates/bootstrap.sh

# ---------- Build args ----------
# customer.yaml.hermes_ref pins a fork tag of the form vYYYY.M.D-smd.N per
# ADR 0015 (rewritten) and SMD_FORK_POLICY.md on venturecrane/hermes-agent.
# The customer.yaml validator (src/lib/ai-employee/customer-yaml/helpers.ts,
# PR #1037) enforces that shape. We clone from the venturecrane fork because
# only the fork carries those tags; for the no-patches discipline, the
# post-clone assertion below verifies the tag points at the matching upstream
# commit SHA — any divergence fails the build (load-bearing for AGPL §13
# unmodified-deployment safe harbor).
ARG HERMES_REF=v2026.5.16-smd.0

# Upstream commit SHA at the equivalent NousResearch/hermes-agent tag. The
# build orchestrator pins this alongside HERMES_REF. If the fork tag points
# anywhere else, the fork is carrying patches and the build fails. The default
# below is the SHA for upstream tag v2026.5.16, documented in
# SMD_FORK_POLICY.md (venturecrane/hermes-agent) and SMD_CHANGELOG.md.
ARG HERMES_UPSTREAM_SHA=a91a57fa5a13d516c38b07a141a9ce8a3daabeb0

# Honcho upstream is plastic-labs/honcho (AGPL-3.0). Pinned via the pip
# package version below. TODO(ci): add a CI assertion that the installed
# Honcho commit hash matches upstream — mirroring the HERMES_SHA check
# pattern so a transparent version drift is caught at build time.
ARG HONCHO_PIP_SPEC="honcho-ai==1.0.0"

# hermes-smd overlay (venturecrane/hermes-smd-overlay): plugin pack + CLI
# (`hermes-smd bootstrap`, `hermes-smd customer-sync`). TODO(pin): replace
# the branch ref with a tagged release once §7 lands.
ARG OVERLAY_REPO="https://github.com/venturecrane/hermes-smd-overlay.git"
ARG OVERLAY_REF="feat/section-7-adapter-port"

ARG CUSTOMER_SLUG=customer-zero

# ---------- Stage 1: clone Hermes at pinned ref ----------
FROM alpine/git:2.45.2 AS hermes_source
ARG HERMES_REF
ARG HERMES_UPSTREAM_SHA
WORKDIR /src
RUN git clone --depth 1 --branch ${HERMES_REF} \
    https://github.com/venturecrane/hermes-agent.git . \
 && git rev-parse HEAD > /src/HERMES_SHA \
 && INSTALLED_SHA="$(cat /src/HERMES_SHA)" \
 && if [ "${INSTALLED_SHA}" != "${HERMES_UPSTREAM_SHA}" ]; then \
      echo "FATAL: Hermes fork tag ${HERMES_REF} points at ${INSTALLED_SHA}" >&2 ; \
      echo "       Expected upstream SHA ${HERMES_UPSTREAM_SHA}." >&2 ; \
      echo "       The fork carries patches; AGPL §13 safe-harbor invalid." >&2 ; \
      echo "       See ADR 0015 and SMD_FORK_POLICY.md on venturecrane/hermes-agent." >&2 ; \
      exit 1 ; \
    fi

# ---------- Stage 2: runtime image ----------
FROM ghcr.io/astral-sh/uv:0.11.6-python3.13-trixie AS uv_source
FROM debian:13.4

ARG CUSTOMER_SLUG
ARG HONCHO_PIP_SPEC
ARG OVERLAY_REPO
ARG OVERLAY_REF

ENV CUSTOMER_SLUG=${CUSTOMER_SLUG}
ENV PYTHONUNBUFFERED=1
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/hermes/.playwright
ENV HERMES_HOME=/opt/data
ENV PATH="/opt/data/.local/bin:/usr/lib/postgresql/16/bin:${PATH}"

# ---------- System packages ----------
# tini: PID 1 zombie reaper (signals + orphaned MCP stdio subprocesses).
# postgresql-16 + redis: in-container Honcho data plane (Debian 13 defaults).
# awscli: needed by bootstrap.sh to fetch customer.yaml from R2 (S3-compat).
# curl + ca-certificates: health checks against the Honcho FastAPI server.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential curl nodejs npm python3 python3-pip python3-venv \
      ripgrep ffmpeg gcc python3-dev libffi-dev procps git openssh-client \
      docker-cli tini ca-certificates \
      postgresql-16 postgresql-client-16 redis-server awscli \
 && rm -rf /var/lib/apt/lists/*

# ---------- hermes user ----------
RUN useradd -u 10000 -m -d /opt/data hermes
COPY --chmod=0755 --from=uv_source /usr/local/bin/uv /usr/local/bin/uvx /usr/local/bin/

WORKDIR /opt/hermes

# ---------- Pull Hermes source from stage 1 ----------
COPY --from=hermes_source /src/ /opt/hermes/
COPY --from=hermes_source /src/HERMES_SHA /opt/hermes/HERMES_SHA

# ---------- Layer-cached Hermes deps install ----------
ENV npm_config_install_links=false
RUN npm install --prefer-offline --no-audit \
 && npx playwright install --with-deps chromium --only-shell \
 && (cd web && npm install --prefer-offline --no-audit) \
 && (cd ui-tui && npm install --prefer-offline --no-audit) \
 && npm cache clean --force

RUN uv sync --frozen --no-install-project --extra all
RUN cd web && npm run build && cd ../ui-tui && npm run build
RUN uv pip install --no-cache-dir --no-deps -e "."

# ---------- Honcho (memory service) ----------
# Installed into Hermes' venv so the migration runner + FastAPI server share
# the same Python. Upstream: github.com/plastic-labs/honcho (AGPL-3.0).
# Postgres + Redis are managed by bootstrap.sh; Honcho talks to 127.0.0.1.
RUN /opt/hermes/.venv/bin/pip install --no-cache-dir "${HONCHO_PIP_SPEC}"

# ---------- hermes-smd overlay (plugins + CLI) ----------
# Pip-install the overlay (provides `hermes-smd` console script for the
# bootstrap translator and customer-sync sidecar) and then register the
# plugin pack with Hermes. Plugins land under ~/.hermes/plugins/ where the
# Hermes plugin loader discovers them at runtime.
RUN /opt/hermes/.venv/bin/pip install --no-cache-dir \
      "git+${OVERLAY_REPO}@${OVERLAY_REF}"

# Plugin install runs as root against /opt/data (the hermes home dir);
# we chown below so the hermes user owns the result.
RUN /opt/hermes/.venv/bin/hermes plugins install \
      venturecrane/hermes-smd-overlay --enable \
 || echo "WARN: hermes plugins install failed; continuing (TODO: harden once overlay registry exists)"

# ---------- Layer in SMD's AI Employee bits ----------
WORKDIR /app

# AIEmployee adapter (trust-ceiling enforcement layer)
COPY ai-employee/adapter/ /app/adapter/

# Canonical skill library (markdown + references)
COPY ai-employee/skills/ /app/skills/

# Tier-1 custom MCP wrappers (one subdir per connector)
COPY ai-employee/connectors/ /app/connectors/

# Safety-substrate tests — bootstrap.sh runs these on container start
COPY ai-employee/safety-substrate/ /app/safety-substrate/

# Bootstrap entrypoint
COPY ai-employee/templates/bootstrap.sh /app/bootstrap.sh
RUN chmod +x /app/bootstrap.sh

# NOTE: customer.yaml is NOT copied into the image. It lives on the Fly
# volume at /opt/data/customer.yaml; bootstrap.sh fetches it from R2 on
# first boot if the volume copy is absent. See §6 of the build plan and
# the customer.yaml -> per-profile config translation ADR.

# ---------- Volume data dirs for Postgres + Redis ----------
# The volume mounts at /opt/data, but initdb (run on first boot in
# bootstrap.sh) needs the parent dir to exist with hermes ownership. We
# create them here so the directory tree is right before the volume mounts;
# the volume mount will shadow them on first boot, then bootstrap.sh's
# mkdir + initdb populate the mounted directories.
RUN mkdir -p /opt/data/honcho/pg /opt/data/honcho/redis /opt/data/.local/bin

# ---------- Permissions ----------
# Everything Hermes / Honcho / bootstrap writes to must be owned by hermes
# (uid 10000). The plugin install above ran as root and dropped files into
# /opt/data/.hermes — chown sweeps them to the right owner.
RUN chmod -R a+rX /opt/hermes /app \
 && chown -R hermes:hermes \
      /opt/hermes/.venv \
      /opt/hermes/ui-tui \
      /opt/hermes/node_modules \
      /app \
      /opt/data

ENV HERMES_WEB_DIST=/opt/hermes/hermes_cli/web_dist

VOLUME [ "/opt/data" ]

# Drop to non-root for runtime. bootstrap.sh does no root-requiring work:
# env validation, R2 fetch, Postgres/Redis startup (data dirs pre-owned by
# hermes), Honcho migrations + serve, safety-substrate python run, and
# hermes-smd bootstrap all run as the hermes user.
# Closes semgrep dockerfile.security.last-user-is-root.
USER hermes

# tini as PID 1: reaps zombies, forwards signals to the foreground child
# (Hermes via `exec` in bootstrap.sh) and to the supervised background
# children (Postgres, Redis, Honcho, customer-sync sidecar).
ENTRYPOINT [ "/usr/bin/tini", "-g", "--", "/app/bootstrap.sh" ]
