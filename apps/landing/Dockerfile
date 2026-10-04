# Static build served by nginx. Build from the repo root:
#   docker build -f apps/landing/Dockerfile -t localix-landing .
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS build
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile
RUN cd apps/landing && bun run build

FROM nginx:alpine@sha256:df221db836e1754089190208cee7eeda94f233197056426eda74a43ab1abeac2
COPY --from=build /repo/apps/landing/dist /usr/share/nginx/html
COPY apps/landing/nginx.conf /etc/nginx/conf.d/default.conf
