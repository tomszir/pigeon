# A Pigeon Lighthouse. Each release publishes it as
# ghcr.io/tomszir/pigeon-lighthouse (.github/workflows/lighthouse-image.yml). Build from the
# repository root:
#   docker build -f apps/lighthouse/Dockerfile -t pigeon-lighthouse .
# Run with a folder holding lighthouse.json; the key and the mail are kept there too:
#   docker run -v ./lighthouse:/data -p 8787:8787 pigeon-lighthouse
FROM node:24.11.1-slim
WORKDIR /app
RUN npm install --global pnpm@12.15.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/lighthouse/package.json packages/lighthouse/
COPY apps/lighthouse/package.json apps/lighthouse/
RUN pnpm install --frozen-lockfile --prod --filter lighthouse...
COPY packages/core/src packages/core/src
COPY packages/lighthouse/src packages/lighthouse/src
COPY apps/lighthouse/src apps/lighthouse/src
# The commit it was built from, which the Lighthouse says in its hello as its own claim.
ARG PIGEON_BUILD=
ENV PIGEON_BUILD=$PIGEON_BUILD
WORKDIR /app/apps/lighthouse
RUN mkdir /data && chown node /data
USER node
VOLUME /data
EXPOSE 8787
# node:sqlite is still marked experimental; its warning on every start says nothing useful.
CMD ["node", "--disable-warning=ExperimentalWarning", "src/main.ts", "--config", "/data/lighthouse.json"]
