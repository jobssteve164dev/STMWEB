FROM docker:27-cli AS docker_cli

FROM node:22-bookworm-slim AS node_runtime

FROM espressif/idf:v5.4.2 AS esp_idf

ENV IDF_PATH=/opt/esp/idf \
    IDF_TOOLS_PATH=/opt/esp \
    IDF_PYTHON_CHECK_CONSTRAINTS=no

RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc-arm-none-eabi libnewlib-arm-none-eabi cmake ninja-build unzip \
 && rm -rf /var/lib/apt/lists/*

COPY --from=docker_cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=node_runtime /usr/local /usr/local

WORKDIR /source
COPY firmware-adapters /opt/stmweb/adapters
CMD ["sh"]
