FROM node:22 AS builder

WORKDIR /usr/src/app

# # Install pnpm
RUN npm i -g pnpm@10.34.5

COPY .env .
COPY pnpm-lock.yaml .
RUN pnpm fetch

ENV APP_PORT=${PORT}
ENV DB_URL=${DATABASE_URL}

# Install the backend together with its workspace execution dependencies.
COPY . .
RUN pnpm i --filter apirequest-backend...
WORKDIR /usr/src/app/packages/apirequest-backend
RUN pnpm exec prisma generate

FROM builder AS dev

ENV PRODUCTION="false"
RUN pnpm --filter @apirequest/runner build

CMD ["pnpm", "run", "start:dev"]

EXPOSE 3170


FROM builder AS prod

ENV PRODUCTION="true"
RUN pnpm --filter @apirequest/runner build
RUN pnpm run build

CMD ["pnpm", "run", "start:prod"]

EXPOSE 3170

