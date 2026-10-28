FROM node:24-bookworm-slim
WORKDIR /demo
COPY --chown=node:node package.json package-lock.json ./
RUN --mount=type=secret,id=build_ca \
    if [ -s /run/secrets/build_ca ]; then npm_config_cafile=/run/secrets/build_ca npm ci --omit=dev; else npm ci --omit=dev; fi \
    && npm cache clean --force
COPY --chown=node:node *.mjs *.sql ./
COPY --chown=node:node web ./web
USER node
CMD ["node", "server.mjs"]
