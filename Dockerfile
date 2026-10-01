FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
RUN mkdir -p /data && chown node:node /data /app/public/img
ENV DATA_DIR=/data PORT=3020 HOST=0.0.0.0 NODE_ENV=production
VOLUME /data
EXPOSE 3020
USER node
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:3020/api/session >/dev/null || exit 1
CMD ["node", "server.js"]
