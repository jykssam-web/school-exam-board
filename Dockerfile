FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3019

ENV PORT=3019
ENV NODE_ENV=production

CMD ["node", "server.js"]
