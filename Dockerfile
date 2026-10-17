# Ticket Price Assistant: API + built UI + SQLite in one image.
# Booking assist needs your local Chrome on port 9222, which a container
# can't reach on Windows/macOS. See README → Docker.

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
COPY demo-site/package.json demo-site/
RUN npm ci --no-audit --no-fund
COPY client client
RUN npm run build -w client

FROM node:24-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3001 \
    DB_FILE=/app/data/ticket-assistant.db
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
COPY demo-site/package.json demo-site/
RUN npm ci --omit=dev -w server --no-audit --no-fund && npm cache clean --force
COPY server server
COPY --from=build /app/client/dist client/dist
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3001
VOLUME ["/app/data"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.js"]
