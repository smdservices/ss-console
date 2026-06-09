# SMD Operator — customer-shape Hermes container
#
# Builds Hermes from upstream at a pinned ref, installs the hermes-smd
# overlay plugins + companion CLI, layers in our Operator adapter / skill
# library / connectors / safety-substrate tests.
#
# Memory (ADR 0016, revised 2026-05-30): Phase 1 runs on Hermes' always-on
# flat-file core (MEMORY.md/USER.md). Honcho — the inferred-memory engine —
# is deferred to Phase 2, when it is vendored as the real plastic-labs/honcho
# v3.0.7 source (api + deriver, pgvector). The earlier in-container `honcho-ai`
# server install was fictional (that package is the client SDK, not the server)
# and is removed. Postgres + Redis remain installed below but are NOT started
# at boot in Phase 1 — they exist only to serve Honcho and are reused in Phase 2.
#
# The container runs a multi-process startup under tini (PID 1, zombie
# reaper). bootstrap.sh fetches customer.yaml, materializes profiles, runs the
# safety substrate, and execs the Hermes gateway. See bootstrap.sh.
#
# Per §6 of the locked build plan and ADR 0019: customer.yaml is NOT baked
# into the image. Provisioning writes it to R2 at vaults/<slug>/customer.yaml;
# bootstrap.sh fetches it to /opt/data/customer.yaml on first boot.
#
# Per-customer build context expects:
#   - operator/adapter/         (Operator adapter — Python)
#   - operator/skills/          (canonical skill library — markdown)
#   - operator/connectors/      (Tier-1 custom MCP wrappers)
#   - operator/safety-substrate/ (Phase A.5 invariant fixtures + runner)
#   - operator/templates/bootstrap.sh

# ---------- Build args ----------
# customer.yaml.hermes_ref pins an upstream Hermes release as
# v{YYYY}.{M}.{D}@{40-hex-sha} per ADR 0024
# (docs/adr/0024-hermes-consumption-and-update-cadence.md). The customer.yaml
# validator (src/lib/operator/customer-yaml/helpers.ts) enforces that shape.
# provision-customer.sh splits the pin into the upstream tag (clone target) and
# the SHA (assertion) and passes both here. We clone NousResearch/hermes-agent
# directly; the venturecrane/hermes-agent fork was retired by ADR 0024.
#
# HERMES_REF is the full pin string, retained for provenance and logging.
ARG HERMES_REF=v2026.5.16@a91a57fa5a13d516c38b07a141a9ce8a3daabeb0

# Upstream date-tag to clone (the part before '@').
ARG HERMES_UPSTREAM_TAG=v2026.5.16

# Upstream commit SHA (the part after '@'). The post-clone assertion verifies
# the cloned HEAD matches this exactly; any divergence (upstream re-tag, stale
# pin) fails the build. This is the integrity check proving we ship unmodified
# upstream Hermes.
ARG HERMES_UPSTREAM_SHA=a91a57fa5a13d516c38b07a141a9ce8a3daabeb0

# hermes-smd overlay (venturecrane/hermes-smd-overlay): plugin pack + CLI
# (`hermes-smd bootstrap`, `hermes-smd customer-sync`) + the importable
# `shared` policy core the runtime plugins depend on. Pinned to a tagged
# release; bump in lockstep with overlay-side feature work.
#
# v0.2.0 was the FLOOR for a harness-complete Machine: the trust plugin does
# `from shared.outbound_gate import evaluate`, and that module first shipped
# after v0.1.1 (overlay #15). The import assert below still guards it.
#
# v0.3.0 restored Hermes' flat-file memory core (stops the MEMORY.md/USER.md
# tombstoning) and deferred Honcho (ADR 0016 revised); customer-zero booted end
# to end on it with 8/8 safety invariants passing. v0.3.1 retires the (dormant)
# composio per-connection isolation guard — composio is dropped, we connect to
# MCPs directly (ADR 0020 revised). v0.3.2 materializes customer.yaml `mcp:`
# connectors into the profile's mcp_servers block (AgentMail is the first
# vendor), bans the agentmail autonomous-send tools at the trust layer, and
# makes the profile-config write atomic (recovers a root-owned config.yaml).
# v0.4.4 adds the voice render-signal fix (#28): render_sample_block now surfaces
# the stored rhythm signal (sentence-length distribution + punctuation), so the
# pre_llm_call voice block can actually shape a draft instead of injecting a thin
# greeting/signoff label. Superset of v0.4.3 (carries all webhook-gate work too).
# v0.4.5 adds _materialize_telegram_platform (#32, ADR 0033): authors the Telegram
# allowlist from customer.yaml.telegram into the profile config.yaml (fail-closed on
# empty allow_from). Superset of v0.4.4.
# v0.4.6 (#35) adds a LOCAL stdio MCP transport to the connector materializer and
# wires Clio (mcp:clio-oktopeak) as a `clio-mcp` command server with a remapped
# env block (ENCRYPTION_KEY <- CLIO_ENCRYPTION_KEY). Pairs with the clio-mcp
# install + Clio token-seed block below. Superset of v0.4.5.
# v0.4.8 (#39) adds the authenticated read-only `GET /runtime/<kind>` to the
# webhook gate (ADR 0043 path A): the console→Machine runtime read the ss-console
# drill-ins call. Per-customer bearer (HMAC-SHA256(master, customer_id), staged
# below as OPERATOR_RUNTIME_READ_KEY), fresh mode=ro connection + busy_timeout,
# ULID keyset pagination, digests never exposed. Superset of v0.4.7.
# v0.4.9 (#40) fixes two gate env-read bugs the live verify-gate caught: the gate
# is a separate process from the Hermes agent, so it reads CUSTOMER_SLUG (its
# Machine-wide var) with SMD_CUSTOMER_SLUG preferred, and treats
# SMD_D1_AUDIT_BINDING as a direct path or a var-name. read_runtime returns
# honest-empty (not 500) when the audit DB/table doesn't exist yet. Superset of v0.4.8.
# v0.4.10 (#41, #42) makes audit emission actually WRITE: D1Client accepts the
# direct-path binding, and AuditLogWriter.ensure_schema() creates audit_log at
# register (the Machine's bootstrap never applied the per-customer migrations, so
# the table was missing). The runtime-read seam now has data to surface
# (ss-console#1285). Superset of v0.4.9.
# v0.4.11 (#43) is THE activation fix: the umbrella register() fans out to all
# sub-plugins. Hermes ignores the plugin.yaml `plugins:` aggregation list, so the
# umbrella had loaded as a manifest-only plugin with no register() — none of the
# five functional plugins (audit, trust, voice, webhook-router, memory-mirror)
# ever registered on a live gateway. No audit, and no trust/ceiling enforcement.
# The new safety-substrate invariant 8 asserts activation as a HARD boot gate.
# Superset of v0.4.10.
ARG OVERLAY_REPO="https://github.com/venturecrane/hermes-smd-overlay.git"
ARG OVERLAY_REF="v0.4.11"

ARG CUSTOMER_SLUG=customer-zero

# ---------- Stage 1: clone Hermes upstream at the pinned tag, assert SHA ----------
FROM alpine/git:2.45.2 AS hermes_source
ARG HERMES_UPSTREAM_TAG
ARG HERMES_UPSTREAM_SHA
WORKDIR /src
RUN git clone --depth 1 --branch ${HERMES_UPSTREAM_TAG} \
    https://github.com/NousResearch/hermes-agent.git . \
 && git rev-parse HEAD > /src/HERMES_SHA \
 && INSTALLED_SHA="$(cat /src/HERMES_SHA)" \
 && if [ "${INSTALLED_SHA}" != "${HERMES_UPSTREAM_SHA}" ]; then \
      echo "FATAL: upstream tag ${HERMES_UPSTREAM_TAG} points at ${INSTALLED_SHA}" >&2 ; \
      echo "       Expected pinned SHA ${HERMES_UPSTREAM_SHA} (from customer.yaml hermes_ref)." >&2 ; \
      echo "       Upstream re-tagged, or the pin is stale; refusing to build." >&2 ; \
      echo "       See ADR 0024." >&2 ; \
      exit 1 ; \
    fi

# ---------- Stage 2: runtime image ----------
FROM ghcr.io/astral-sh/uv:0.11.6-python3.13-trixie AS uv_source
FROM debian:13.4

ARG CUSTOMER_SLUG
ARG OVERLAY_REPO
ARG OVERLAY_REF

ENV CUSTOMER_SLUG=${CUSTOMER_SLUG}
ENV PYTHONUNBUFFERED=1
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/hermes/.playwright
ENV HERMES_HOME=/opt/data
ENV PATH="/opt/data/.local/bin:/usr/lib/postgresql/17/bin:${PATH}"

# ---------- System packages ----------
# tini: PID 1 zombie reaper (signals + orphaned MCP stdio subprocesses).
# postgresql-17 + redis: installed for Phase 2 Honcho's data plane but NOT
# started at boot in Phase 1 (Debian 13 trixie ships PostgreSQL 17 as default;
# postgresql-16 is not in trixie's repos — keep 17 so the Phase-2 vendor lands
# cleanly). awscli: bootstrap.sh fetches customer.yaml from R2 (S3-compat).
# curl + ca-certificates: R2 fetch + general TLS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential curl nodejs npm python3 python3-pip python3-venv \
      ripgrep ffmpeg gcc python3-dev libffi-dev procps git openssh-client \
      docker-cli tini ca-certificates \
      postgresql-17 postgresql-client-17 redis-server awscli \
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

# `--extra all` deliberately EXCLUDES the `messaging` extra (python-telegram-bot,
# discord.py, slack-bolt) — verified against the pinned ref's pyproject. Without
# `--extra messaging` the native Telegram adapter imports fail and the platform is
# inert (TELEGRAM_AVAILABLE=False), so a TELEGRAM_BOT_TOKEN env would silently do
# nothing. We add it explicitly: lock-governed (frozen) and forward-aligned with the
# Slack/Discord channels the productized Operator will offer. See ADR 0033.
RUN uv sync --frozen --no-install-project --extra all --extra messaging
RUN cd web && npm run build && cd ../ui-tui && npm run build
RUN uv pip install --no-cache-dir --no-deps -e "."

# ---------- Honcho: deferred to Phase 2 (ADR 0016, revised 2026-05-30) ----------
# No in-container Honcho server is installed. The prior `honcho-ai` pip install
# was fictional — that package is the Honcho CLIENT SDK, not the server; the
# real server is the plastic-labs/honcho v3.0.7 SOURCE repo (fastapi api +
# `python -m src.deriver` worker, pgvector, mandatory LLM provider). Phase 2
# vendors it the same way upstream Hermes is vendored above (clone at a pinned
# tag, own venv). Phase 1 runs on Hermes' flat-file memory core.

# ---------- hermes-smd overlay (plugins + CLI) ----------
# Pip-install the overlay (provides `hermes-smd` console script for the
# bootstrap translator and customer-sync sidecar) and then register the
# plugin pack with Hermes. Plugins land under ~/.hermes/plugins/ where the
# Hermes plugin loader discovers them at runtime.
RUN uv pip install --no-cache-dir \
      "git+${OVERLAY_REPO}@${OVERLAY_REF}"

# ---------- Gmail reader deps (crane_gmail.py — inbox-triage fetch path) ----------
# The inbox-triage skill shells to operator/connectors/google/crane_gmail.py
# to read the principal's Gmail via a user-OAuth token (ADR 0010). These two
# libraries are all it needs (read/modify; no oauthlib — consent happens off-box).
RUN uv pip install --no-cache-dir google-api-python-client google-auth

# ---------- Clio MCP server (law vertical practice-management connector) ----------
# @oktopeak/clio-mcp (MIT) is a LOCAL stdio MCP server. The overlay (v0.4.6+)
# materializes customer.yaml `mcp:clio-oktopeak` into the profile mcp_servers
# block as a `clio-mcp` command server; install it globally so the binary is on
# PATH for the gateway to launch. Pinned to 2.0.0 — the version the connector
# reality-check and live loop test ran against. It reads its OAuth token from
# ~/.clio-mcp/tokens.enc (seeded by bootstrap.sh) under ENCRYPTION_KEY.
RUN npm install -g @oktopeak/clio-mcp@2.0.0

# Register the plugin pack with Hermes' loader. `hermes plugins install` clones
# the overlay repo's DEFAULT BRANCH HEAD into ~/.hermes/plugins/ — upstream
# hermes_cli/plugins_cmd.py `_install_plugin_core` does `git clone --depth 1`
# with no ref argument, so the plugin surface cannot be pinned through this
# command (tracked follow-up; for a tagged-release build, default branch == the
# tag). The pip install above IS pinned and provides the importable `shared`
# policy core, which is what the runtime plugins actually `import`.
#
# FAIL-CLOSED: the prior `|| echo "WARN ...; continuing"` swallowed an install
# failure and booted a silently harness-less Machine — the exact fail-open
# defect the venture forbids. Both the install and the policy-core import below
# are now hard build gates: a Machine whose trust/inbound plugins cannot load
# their own policy core MUST NOT build green.
RUN /opt/hermes/.venv/bin/hermes plugins install \
      venturecrane/hermes-smd-overlay --enable

# Deterministic build-time assertion that the pinned `shared` policy core is
# importable in the venv. This catches a stale/mis-pinned OVERLAY_REF (the exact
# v0.1.1 `ModuleNotFoundError: shared.outbound_gate`) at BUILD time rather than
# as a runtime plugin-load failure. Runtime plugin REGISTRATION (Hermes actually
# loaded the pack) is verified live by boot-smoke-test.sh step 7, which runs
# `hermes plugins list | grep hermes-smd-` inside the booted Machine where a
# profile exists.
RUN /opt/hermes/.venv/bin/python3 -c \
      "import shared.outbound_gate, shared.inbound, shared.action_classes; \
from shared.outbound_gate import evaluate; \
print('overlay policy core import OK (outbound_gate.evaluate resolved)')"

# ---------- Layer in SMD's Operator bits ----------
WORKDIR /app

# Operator adapter (trust-ceiling enforcement layer)
COPY operator/adapter/ /app/adapter/

# Canonical skill library (markdown + references)
COPY operator/skills/ /app/skills/

# Tier-1 custom MCP wrappers (one subdir per connector)
COPY operator/connectors/ /app/connectors/

# Safety-substrate tests — bootstrap.sh runs these on container start
COPY operator/safety-substrate/ /app/safety-substrate/

# Bootstrap entrypoint
COPY operator/templates/bootstrap.sh /app/bootstrap.sh
RUN chmod +x /app/bootstrap.sh

# Curator disable guard (ADR 0017). bootstrap.sh step 7b runs this after the
# overlay materializes profile configs, ensuring the autonomous curator is off
# before Hermes starts; the boot smoke test re-runs it with --check.
COPY operator/templates/ensure-curator-disabled.py /app/ensure-curator-disabled.py
COPY operator/templates/ensure-disabled-skills.py /app/ensure-disabled-skills.py
COPY operator/templates/ensure-operator-identity.py /app/ensure-operator-identity.py
COPY operator/templates/ensure-telegram-allowlist.py /app/ensure-telegram-allowlist.py

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
# env validation, R2 fetch, safety-substrate python run, hermes-smd bootstrap,
# and the Hermes gateway all run as the hermes user.
# Closes semgrep dockerfile.security.last-user-is-root.
USER hermes

# tini as PID 1: reaps zombies, forwards signals to the foreground child
# (the Hermes gateway via `exec` in bootstrap.sh) and to any supervised
# background children (the customer-sync sidecar; Phase 2 adds Honcho).
ENTRYPOINT [ "/usr/bin/tini", "-g", "--", "/app/bootstrap.sh" ]
