# SMD AI Employee — customer-shape Hermes container
#
# Builds Hermes from upstream at a pinned ref, layers in our AIEmployee
# adapter + customer config + skill library, and starts the agent loop
# under tini for proper signal/zombie handling.
#
# Per-customer build context expects:
#   - ai-employee/adapter/        (AIEmployee adapter — Python)
#   - ai-employee/skills/         (canonical skill library — markdown)
#   - ai-employee/connectors/     (Tier-1 custom MCP wrappers)
#   - ai-employee/customers/<slug>/customer.yaml (rendered into /app/customer.yaml)
#
# The bootstrap.sh entrypoint reads /app/customer.yaml, resolves skill
# version pins, runs the safety-substrate invariant checks, and starts
# Hermes only after substrate passes.

# ---------- Build args (set by provision-customer.sh per customer) ----------
# Hermes uses date-based tags (v2026.MM.DD). Latest at time of writing: v2026.5.7.
# Move to a SHA pin in Phase A.5 for stronger reproducibility.
ARG HERMES_REF=v2026.5.7
ARG CUSTOMER_SLUG=customer-zero

# ---------- Stage 1: clone Hermes at pinned ref ----------
FROM alpine/git:2.45.2 AS hermes_source
ARG HERMES_REF
WORKDIR /src
RUN git clone --depth 1 --branch ${HERMES_REF} \
    https://github.com/NousResearch/hermes-agent.git . \
 && git rev-parse HEAD > /src/HERMES_SHA

# ---------- Stage 2: build base from upstream Hermes Dockerfile pattern ----------
FROM ghcr.io/astral-sh/uv:0.11.6-python3.13-trixie AS uv_source
FROM tianon/gosu:1.19-trixie AS gosu_source
FROM debian:13.4

ARG CUSTOMER_SLUG
ENV CUSTOMER_SLUG=${CUSTOMER_SLUG}

ENV PYTHONUNBUFFERED=1
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/hermes/.playwright
ENV HERMES_HOME=/opt/data
ENV PATH="/opt/data/.local/bin:${PATH}"

# tini reaps orphaned zombie processes (MCP stdio subprocesses, etc.) that
# would otherwise accumulate when hermes runs as PID 1.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential curl nodejs npm python3 ripgrep ffmpeg gcc \
      python3-dev libffi-dev procps git openssh-client docker-cli tini \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN useradd -u 10000 -m -d /opt/data hermes
COPY --chmod=0755 --from=gosu_source /gosu /usr/local/bin/
COPY --chmod=0755 --from=uv_source /usr/local/bin/uv /usr/local/bin/uvx /usr/local/bin/

WORKDIR /opt/hermes

# Pull Hermes source from stage 1
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

# ---------- Layer in SMD's AI Employee bits ----------
WORKDIR /app

# AIEmployee adapter (trust-ceiling enforcement layer)
COPY ai-employee/adapter/ /app/adapter/

# Canonical skill library (markdown + references)
COPY ai-employee/skills/ /app/skills/

# Tier-1 custom MCP wrappers (one subdir per connector)
COPY ai-employee/connectors/ /app/connectors/

# Per-customer config — provision-customer.sh renders the right customer.yaml
# into this exact path before building.
COPY ai-employee/customers/${CUSTOMER_SLUG}/customer.yaml /app/customer.yaml

# Safety-substrate tests — Phase A.5 runs these on container start
COPY ai-employee/safety-substrate/ /app/safety-substrate/

# Bootstrap entrypoint
COPY ai-employee/templates/bootstrap.sh /app/bootstrap.sh
RUN chmod +x /app/bootstrap.sh

# ---------- Permissions ----------
USER root
RUN chmod -R a+rX /opt/hermes /app \
 && chown -R hermes:hermes /opt/hermes/.venv /opt/hermes/ui-tui /opt/hermes/node_modules /app

ENV HERMES_WEB_DIST=/opt/hermes/hermes_cli/web_dist

VOLUME [ "/opt/data" ]

# tini for signal handling + zombie reaping; bootstrap.sh runs safety
# substrate then starts Hermes.
ENTRYPOINT [ "/usr/bin/tini", "-g", "--", "/app/bootstrap.sh" ]
