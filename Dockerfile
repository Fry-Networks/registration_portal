FROM 1password/op:2@sha256:57d7d6a2bb2b74b2cf8111f6afb2973c74772198f82ea30359a53faae9fff5b1 AS op

FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN npm install -g npm@11.8.0
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY .npmrc* ./
RUN npm install

FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN npm install -g npm@11.8.0
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY .npmrc* ./

# Build-time placeholders (no secrets)
ARG MONGO_URI_PLACEHOLDER="mongodb://placeholder.invalid:27017/dummy"
ARG NEXT_PUBLIC_WEEKLY_REWARDS_ENABLED="true"
ARG NEXT_PUBLIC_TEST_MODE="false"
ARG NEXT_PUBLIC_CREDENTIALS_NEEDED="AEM"
ARG NEXT_PUBLIC_DIMO_CLIENT_ID=""
ARG NEXT_PUBLIC_DIMO_REDIRECT_URI=""
ARG NEXT_PUBLIC_DIMO_ENV="production"
ENV MONGO_URI=${MONGO_URI_PLACEHOLDER}
ENV NEXT_PUBLIC_WEEKLY_REWARDS_ENABLED=${NEXT_PUBLIC_WEEKLY_REWARDS_ENABLED}
ENV NEXT_PUBLIC_TEST_MODE=${NEXT_PUBLIC_TEST_MODE}
ENV NEXT_PUBLIC_CREDENTIALS_NEEDED=${NEXT_PUBLIC_CREDENTIALS_NEEDED}
ENV NEXT_PUBLIC_DIMO_CLIENT_ID=${NEXT_PUBLIC_DIMO_CLIENT_ID}
ENV NEXT_PUBLIC_DIMO_REDIRECT_URI=${NEXT_PUBLIC_DIMO_REDIRECT_URI}
ENV NEXT_PUBLIC_DIMO_ENV=${NEXT_PUBLIC_DIMO_ENV}

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS dev
WORKDIR /app
RUN npm install -g npm@11.8.0
ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=op /usr/local/bin/op /usr/local/bin/op
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY .npmrc* ./
COPY . .
COPY op-entrypoint.sh /usr/local/bin/op-entrypoint.sh
RUN chmod 755 /usr/local/bin/op-entrypoint.sh \
  && groupadd -g 1001 app \
  && useradd -u 1001 -g 1001 -m -s /usr/sbin/nologin app \
  && chown -R app:app /app
USER app
ENTRYPOINT ["/usr/local/bin/op-entrypoint.sh"]
CMD ["bash", "start-dev-with-1password.sh"]

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3007
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy 1Password CLI from the official image
COPY --from=op /usr/local/bin/op /usr/local/bin/op

# Next.js standalone output
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
RUN mkdir -p /app/scripts
COPY --from=builder /app/scripts/sync-creds-hardware-verified.js /app/scripts/sync-creds-hardware-verified.js

# Runtime entrypoint for 1Password secrets
COPY op-entrypoint.sh /usr/local/bin/op-entrypoint.sh
RUN chmod 755 /usr/local/bin/op-entrypoint.sh \
  && groupadd -g 1001 app \
  && useradd -u 1001 -g 1001 -m -s /usr/sbin/nologin app \
  && chown -R app:app /app

USER app
EXPOSE 3007
ENTRYPOINT ["/usr/local/bin/op-entrypoint.sh"]
CMD ["node", "server.js"]
