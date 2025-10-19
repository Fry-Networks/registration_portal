# Use official Node.js image
FROM node:22
RUN npm install -g npm@latest

# Install 1Password CLI (op) for runtime secret injection
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl gnupg \
  && curl -sS https://downloads.1password.com/linux/keys/1password.asc | gpg --dearmor -o /usr/share/keyrings/1password-archive-keyring.gpg \
  && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/1password-archive-keyring.gpg] https://downloads.1password.com/linux/debian/amd64 stable main" > /etc/apt/sources.list.d/1password.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends 1password-cli \
  && apt-get purge -y --auto-remove gnupg \
  && rm -rf /var/lib/apt/lists/*

# Workdir
WORKDIR /app

# Install deps first (better cache)
COPY package*.json ./
RUN npm ci || npm install

# Provide placeholder values for env vars that are validated during build.
ARG MONGO_URI_PLACEHOLDER="mongodb://placeholder.invalid:27017/dummy"
ENV MONGO_URI=${MONGO_URI_PLACEHOLDER}
ARG NEXT_PUBLIC_WEEKLY_REWARDS_ENABLED="true"
ARG NEXT_PUBLIC_TEST_MODE="false"
ARG NEXT_PUBLIC_CREDENTIALS_NEEDED="AEM"
ENV NEXT_PUBLIC_WEEKLY_REWARDS_ENABLED=${NEXT_PUBLIC_WEEKLY_REWARDS_ENABLED}
ENV NEXT_PUBLIC_TEST_MODE=${NEXT_PUBLIC_TEST_MODE}
ENV NEXT_PUBLIC_CREDENTIALS_NEEDED=${NEXT_PUBLIC_CREDENTIALS_NEEDED}

# Copy the rest
COPY . .

# Build (adjust if your build script differs)
RUN npm run build

# Run as non-root
RUN chown -R node:node /app
USER node

# App port (internal)
EXPOSE 3007

# Start (adjust if your start script differs)
CMD ["sh", "-c", "op run -- npm start"]
