# Build stage: install everything, build the browser bundles, then drop dev-only packages
FROM node:26-trixie-slim AS build
WORKDIR /app
COPY package*.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci && npm cache clean --force
COPY . .
RUN npm run build && npm prune --omit=dev

# Runtime stage: only Node, the app and its production packages (npm itself is removed: never needed to run)
FROM node:26-trixie-slim
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
  && mkdir -p /data && chown node:node /data
WORKDIR /app
COPY --from=build --chown=root:root /app /app
# Inside the container we listen on all interfaces; docker-compose only publishes to 127.0.0.1.
# The reverse proxy reaches us from Docker's private network, so trust X-Forwarded-* from there.
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 TRUST_PROXY=uniquelocal DATA_DIR=/data
VOLUME /data
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.js"]
