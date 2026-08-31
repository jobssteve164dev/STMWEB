FROM docker:27-cli AS docker_cli

FROM node:22-bookworm-slim AS node_runtime

FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive
ARG IDF_VERSION=v5.4.2

ENV IDF_PATH=/opt/esp/idf \
    IDF_TOOLS_PATH=/opt/esp \
    IDF_CCACHE_ENABLE=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bison \
      bzip2 \
      ca-certificates \
      ccache \
      check \
      cmake \
      curl \
      flex \
      gcc-arm-none-eabi \
      git \
      gperf \
      libbsd-dev \
      libffi-dev \
      libglib2.0-0 \
      libncurses-dev \
      libnewlib-arm-none-eabi \
      libpixman-1-0 \
      libusb-1.0-0-dev \
      make \
      ninja-build \
      python3 \
      python3-venv \
      unzip \
      wget \
      xz-utils \
 && rm -rf /var/lib/apt/lists/* \
 && update-alternatives --install /usr/bin/python python /usr/bin/python3 10

RUN git clone --recursive --depth=1 --shallow-submodules \
      --branch "$IDF_VERSION" https://github.com/espressif/esp-idf.git "$IDF_PATH" \
 && git config --system --add safe.directory "$IDF_PATH" \
 && "$IDF_PATH/tools/idf_tools.py" --non-interactive install required --targets=esp32s3 \
 && "$IDF_PATH/tools/idf_tools.py" --non-interactive install cmake \
 && "$IDF_PATH/tools/idf_tools.py" --non-interactive install-python-env \
 && rm -rf "$IDF_TOOLS_PATH/dist"

ENV IDF_PYTHON_CHECK_CONSTRAINTS=no

COPY --from=docker_cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=node_runtime /usr/local /usr/local

WORKDIR /source
COPY firmware-adapters /opt/stmweb/adapters
CMD ["sh"]
