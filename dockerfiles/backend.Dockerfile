# syntax=docker/dockerfile:1

# AI Budgeting API backend: serves Express routes and connects to Actual Budget.
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="AI Budgeting Backend" \
      org.opencontainers.image.description="Express API backend for AI Budgeting" \
      org.opencontainers.image.source="local"
ENV NODE_ENV=production PORT=3010 CONFIG_PATH=/app/data/config.json
WORKDIR /app
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node server ./server
RUN mkdir -p /app/cache /app/data && chown -R node:node /app/cache /app/data
USER node
EXPOSE 3010
CMD ["node", "server/index.js"]
