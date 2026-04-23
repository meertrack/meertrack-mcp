# syntax=docker/dockerfile:1.7

# ----- Build stage: install all deps, compile TS to dist/ -----
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ----- Prod deps stage: install only runtime deps -----
FROM node:20-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ----- Runtime stage: minimal image, non-root user -----
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001

# Fly.io's MCP convention is port 3001 (matches `fly mcp proxy` defaults).
EXPOSE 3001

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER node

CMD ["node", "dist/index.js", "--http"]
