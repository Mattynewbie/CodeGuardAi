FROM node:24-slim

WORKDIR /app

COPY package*.json ./
COPY frontend/package*.json ./frontend/
COPY backend/package*.json ./backend/
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=4100
EXPOSE 4100

CMD ["npm", "run", "start"]
