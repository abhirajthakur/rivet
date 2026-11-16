FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install --yes --no-install-recommends bash ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable \
  && corepack prepare pnpm@12.21.0 --activate

WORKDIR /workspace
ENV CI=true
ENV NODE_ENV=test

USER node
