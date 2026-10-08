# Rakazo computer image for Cloudflare Containers.
#
# Derived from infra/sandboxes/computer/Dockerfile (the desktop stack below is
# that Dockerfile verbatim, with COPY paths prefixed by `computer/` and the
# final stage named). Keep the two in sync when the computer image changes:
# this variant additionally mounts the bot's R2 home via tigrisfs, runs a small
# control agent on :8090, and stays root so the mount can happen before
# dropping to the `rakazo` user for the desktop.
FROM debian:bookworm-slim AS capture-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libx11-dev \
    libxdamage-dev \
    libxext-dev \
    libxfixes-dev \
    libxtst-dev \
    libpng-dev \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY computer/xcapture.c .
RUN cc -O3 -fPIC -shared -Wall -Wextra -Werror -o librakazo-xcapture.so xcapture.c \
    -lX11 -lXext -lXdamage -lXfixes -lXtst -lpng

FROM debian:bookworm-slim AS computer
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    fluxbox \
    xterm \
    xdotool \
    xclip \
    x11-utils \
    x11-xserver-utils \
    imagemagick \
    novnc \
    websockify \
    python3 \
    ca-certificates \
    procps \
    bash \
    chromium \
    fonts-liberation \
    fonts-dejavu-core \
    fontconfig \
    fonts-thai-tlwg \
    fonts-noto-core \
    fonts-noto-color-emoji \
    pcmanfm \
    zip \
    unzip \
    jq \
    less \
    nano \
    sqlite3 \
    dbus-x11 \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --gid 1000 rakazo \
  && useradd --uid 1000 --gid rakazo --create-home --shell /bin/bash rakazo \
  && mkdir -p /etc/rakazo/fluxbox \
  && printf '%s\n' '#!/bin/sh' 'exec xsetroot -solid "#111113" "$@"' > /usr/bin/fbsetbg \
  && chmod +x /usr/bin/fbsetbg \
  && ln -sfn /bin/true /usr/bin/xmessage
ENV DISPLAY=:1
ENV HOME=/home/rakazo
WORKDIR /home/rakazo
# --chmod normalizes modes: a restrictive host umask (e.g. 077 on hardened hosts) would
# otherwise leave these files unreadable to USER 1000 at runtime.
COPY --chmod=755 computer/start.sh /usr/local/bin/rakazo-computer
COPY --chmod=755 computer/control.py /usr/local/bin/rakazo-computer-control
COPY --from=capture-builder /build/librakazo-xcapture.so /usr/local/lib/librakazo-xcapture.so
COPY --chmod=755 computer/rakazo-browser /usr/local/bin/rakazo-browser
COPY --chmod=755 computer/rakazo-page-browser /usr/local/bin/rakazo-page-browser
COPY --chmod=644 computer/rakazo-browser.desktop /usr/share/applications/rakazo-browser.desktop
COPY --chmod=644 computer/fluxbox.init /etc/rakazo/fluxbox/init
COPY --chmod=644 computer/fluxbox.apps /etc/rakazo/fluxbox/apps
COPY --chmod=644 computer/fluxbox.menu /etc/rakazo/fluxbox/menu
COPY --chmod=644 computer/embed.html /usr/share/novnc/embed.html
COPY --chmod=644 computer/clipboard-bridge.js /usr/share/novnc/clipboard-bridge.js
COPY --chmod=644 computer/mobile-keyboard.js /usr/share/novnc/mobile-keyboard.js
# Browser JS kernel for the `js` tool: playwright-core over CDP (no bundled
# browsers — it attaches to the Chromium already on the display).
COPY --chmod=755 computer/rakazo-browser-kernel.mjs /usr/local/lib/rakazo/rakazo-browser-kernel.mjs
# Strip CR so shebangs work even if the build context came from a CRLF checkout.
RUN ldconfig \
  && sed -i 's/\r$//' /usr/local/bin/rakazo-computer /usr/local/bin/rakazo-computer-control /usr/local/bin/rakazo-browser /usr/local/bin/rakazo-page-browser \
    /etc/rakazo/fluxbox/init /etc/rakazo/fluxbox/apps /etc/rakazo/fluxbox/menu
# Node 22 + ThaiFi wallet CLI, baked in so every bot starts with a runtime and
# wallet commands instead of self-installing them during tasks (the install used
# to eat minutes of each new bot's first runs).
RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y --no-install-recommends nodejs \
  && npm install -g thaifi-wallet-cli@0.3.6 playwright-core@1.59.1 \
  && npm cache clean --force \
  && rm -rf /var/lib/apt/lists/*
# Google Chrome: real Chrome signs into Google accounts and plays the
# DRM/proprietary-codec media Debian chromium cannot. Cloudflare Containers
# are amd64-only, so no architecture guard is needed here (chromium stays
# installed as the binary fallback).
RUN curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/google-chrome.deb \
  && apt-get update \
  && apt-get install -y --no-install-recommends /tmp/google-chrome.deb \
  && rm -f /tmp/google-chrome.deb \
  && rm -rf /var/lib/apt/lists/* \
  && google-chrome-stable --version
# Popular Thai Google families on top of the TLWG/Noto base, so Thai sites in
# Chromium render with real Thai typefaces (Sarabun, Prompt, Kanit, ...).
# Best-effort: a failed download just leaves fewer families behind.
RUN install -d /usr/local/share/fonts/thai-google \
  && for fam in Sarabun Prompt Kanit Mitr "Bai+Jamjuree" "Chakra+Petch" K2D KoHo Krub \
                Pridi Maitree "IBM+Plex+Sans+Thai" "IBM+Plex+Sans+Thai+Looped" Anuphan "Noto+Sans+Thai"; do \
      css=$(curl -fsSL "https://fonts.googleapis.com/css2?family=${fam}:wght@400;500;700" || true); \
      [ -n "$css" ] || continue; \
      i=0; \
      for url in $(printf '%s\n' "$css" | grep -oE 'https://[^)]+\.ttf' | sort -u); do \
        i=$((i + 1)); \
        curl -fsSL -o "/usr/local/share/fonts/thai-google/$(printf '%s' "$fam" | tr -d '+')-${i}.ttf" "$url" \
          || rm -f "/usr/local/share/fonts/thai-google/$(printf '%s' "$fam" | tr -d '+')-${i}.ttf"; \
      done; \
    done \
  && fc-cache -fs || true

# --- cloudflare layer: R2 home mount + control agent -------------------------
FROM computer AS cloudflare
RUN apt-get update && apt-get install -y --no-install-recommends \
      fuse3 \
      gosu \
    && curl -fsSL -o /tmp/tigrisfs.deb \
      https://github.com/tigrisdata/tigrisfs/releases/download/v1.2.2/tigrisfs_1.2.2_linux_amd64.deb \
    && apt-get install -y --no-install-recommends /tmp/tigrisfs.deb \
    && rm -f /tmp/tigrisfs.deb \
    && rm -rf /var/lib/apt/lists/* \
    && install -d -o 1000 -g 1000 /var/rakazo/browser-profiles /var/log/rakazo
COPY --chmod=755 startup-cf.sh /usr/local/bin/rakazo-cf-startup
COPY --chmod=755 agent.js /usr/local/lib/rakazo/agent.js
ENV R2_MOUNT_POINT=/home/rakazo
ENV AGENT_PORT=8090
# Deliberately root: rakazo-cf-startup mounts R2, then drops to the rakazo
# user for both the control agent and the desktop.
CMD ["/usr/local/bin/rakazo-cf-startup"]
