# syntax=docker/dockerfile:1

# Actual AI frontend: builds and serves the Next.js application.
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY actual-ai/package.json actual-ai/package-lock.json ./
RUN npm ci

FROM dependencies AS build
ARG NEXT_PUBLIC_ACTUAL_API_BASE=http://localhost:3010
ENV NEXT_PUBLIC_ACTUAL_API_BASE=${NEXT_PUBLIC_ACTUAL_API_BASE}
COPY actual-ai/ ./
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="AI Budgeting Frontend" \
      org.opencontainers.image.description="Next.js frontend for AI Budgeting" \
      org.opencontainers.image.source="local"
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["npm", "start"]
