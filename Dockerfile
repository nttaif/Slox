# --- STAGE 1: DEVELOPMENT ---
FROM node:20-alpine AS development

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci

COPY . .

# Generate Prisma client
RUN npx prisma generate

# --- STAGE 2: BUILD ---
FROM node:20-alpine AS build

WORKDIR /usr/src/app

COPY package*.json ./
COPY --from=development /usr/src/app/node_modules ./node_modules
COPY . .

RUN npm run build

ENV NODE_ENV=production
RUN npm ci --only=production && npm cache clean --force

# Re-generate Prisma client cho production deps
RUN npx prisma generate

# --- STAGE 3: PRODUCTION ---
FROM node:20-alpine AS production

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

RUN mkdir -p logs && chown -R node:node logs

COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist

USER node

EXPOSE 3000

CMD ["node", "dist/main"]