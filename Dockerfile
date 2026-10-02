FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    DATA_DIR=/data/state

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force \
    && mkdir -p /data \
    && chown node:node /data

COPY bot.js ./
COPY utils/ ./utils/
COPY scripts/ ./scripts/

USER node
STOPSIGNAL SIGTERM
CMD ["node", "bot.js"]
