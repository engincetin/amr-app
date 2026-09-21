# AMR uygulaması: Kanzasset'e API ve fiyat soketi veren, rafineri ekranlarını sunan servis.
# Ekranlar derlenir ve sunucunun içinden servis edilir (tek port: 4000).
FROM node:22-alpine

WORKDIR /app

# Bağımlılıklar önce: kaynak değişince kurulum yeniden yapılmasın
COPY package.json package-lock.json ./
COPY packages/contract/package.json packages/contract/
COPY apps/amr-server/package.json apps/amr-server/
COPY apps/amr-web/package.json apps/amr-web/
COPY apps/mock-merkez/package.json apps/mock-merkez/
RUN npm ci

COPY . .
RUN npm run build -w @amr/contract && npm run build -w @amr/web

ENV NODE_OPTIONS=--no-warnings
ENV PORT=4000
ENV DB_PATH=/data/amr.db
VOLUME ["/data"]
EXPOSE 4000

CMD ["npm", "run", "start", "-w", "@amr/server"]
