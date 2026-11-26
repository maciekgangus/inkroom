# The renderer of lesson videos (R-115, ADR 0029): the worker that takes recordings from the app's
# queue, draws them in a headless Chromium and encodes them with ffmpeg. The base image brings Node,
# Chromium and what it needs; its version must be the one of `playwright` in package.json.
FROM mcr.microsoft.com/playwright:v1.65.0-noble

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY render.mjs ./

# Not root. Chromium's own sandbox needs privileges the container does not give; the only page it
# opens is this app's render page, which draws a board and runs no one's code.
USER pwuser
ENV RENDER_NO_SANDBOX=1 RENDER_TMP=/tmp
# Low priority, so the app stays responsive while a lesson is rendered (priority 1).
CMD ["nice", "-n", "10", "node", "render.mjs", "--worker"]
