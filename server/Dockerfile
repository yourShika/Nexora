# Nexora-Server: keine npm-Abhängigkeiten, darum kein npm install im Bau.
# Bau aus dem Wurzelordner des Repos (compose: context = Repo, dockerfile = server/Dockerfile)
FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY server/ ./server/
# /data gehört dem Benutzer node; ein benanntes Volume übernimmt das beim ersten Start, ohne Startskript
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
EXPOSE 8080
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
