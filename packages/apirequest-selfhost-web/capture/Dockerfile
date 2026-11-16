FROM node:22-bookworm-slim AS build
WORKDIR /source
# 仅构建无框架依赖的控制服务，避免安装整个工作台的前端与桌面依赖。
COPY packages/apirequest-selfhost-web/capture/ ./capture/
RUN npm exec --yes --package=esbuild@0.25.12 -- esbuild capture/server.ts --bundle --platform=node --format=esm --outfile=dist/server.mjs
RUN mkdir -p dist/engine /node-libs && cp capture/*.py dist/engine/ && cp -L /usr/lib/*-linux-gnu/libstdc++.so.6 /node-libs/

# 复用同版本官方引擎镜像，避免另行解析一套 Python 协议依赖。
FROM mitmproxy/mitmproxy:12.3.0
ENTRYPOINT []
COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build /node-libs/ /usr/local/lib/
ENV LD_LIBRARY_PATH=/usr/local/lib
WORKDIR /app
COPY --from=build /source/dist /app
RUN useradd --create-home --uid 10001 capture && mkdir /data && chown capture:capture /data
USER capture
ENV APIREQUEST_CAPTURE_SERVER_ENTRY=true APIREQUEST_CAPTURE_CONTROL_BIND=0.0.0.0 APIREQUEST_CAPTURE_CA_DIR=/data
VOLUME /data
EXPOSE 3190/tcp
CMD ["node", "server.mjs"]
