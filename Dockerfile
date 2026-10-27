# Builds one backend app. Usage: docker build --build-arg APP=integrator -t hippo-integrator .
FROM node:24-alpine AS build
ARG APP
RUN npm install -g pnpm@12.15.0
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/${APP} ./apps/${APP}
RUN pnpm install --frozen-lockfile --filter "@hippo/${APP}..." --ignore-scripts
RUN pnpm --filter "@hippo/${APP}" build

FROM node:24-alpine
ARG APP
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/${APP}/dist ./dist
USER node
CMD ["node", "dist/index.js"]
