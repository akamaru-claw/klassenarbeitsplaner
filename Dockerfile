FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY public ./public
RUN mkdir -p /data && chown node:node /data
ENV DATA_DIR=/data PORT=3000 NODE_ENV=production
VOLUME /data
EXPOSE 3000
USER node
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/session >/dev/null || exit 1
CMD ["node", "server.js"]
