# Jamot Lite — one company, one container.
#
#   docker run -it --rm -v jamot:/data ghcr.io/jamot-pro/jamot-lite setup
#   docker run -d --name jamot -p 127.0.0.1:3000:3000 -v jamot:/data --restart unless-stopped ghcr.io/jamot-pro/jamot-lite
#
# Everything the company has lives in the /data volume: back it up.

FROM node:24-slim AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
# Litestream, for continuous off-site copies (jamot replicate): the pinned
# release, refused unless its checksum matches.
ARG TARGETARCH=amd64
RUN node scripts/fetch-litestream.mjs "$TARGETARCH" /litestream

FROM node:24-slim
LABEL org.opencontainers.image.source="https://github.com/jamot-pro/JamotLite" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.description="The organization that doesn't die when people leave."
ENV NODE_ENV=production \
    JAMOT_HOME=/data \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
# The bundle needs nothing from node_modules: one file, the templates and the console.
COPY --from=build /src/dist/ /app/
# Jamot's own company file, so the image can run Jamot as a Jamot company.
COPY --from=build /src/jamot.company.yaml /app/jamot.company.yaml
COPY --from=build /litestream/litestream /usr/local/bin/litestream
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "--disable-warning=DEP0040", "/app/jamot.mjs"]
CMD ["start"]
