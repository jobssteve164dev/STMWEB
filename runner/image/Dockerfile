FROM docker:27-cli AS docker_cli

FROM espressif/idf:v5.4.2 AS esp_idf

FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc-arm-none-eabi libnewlib-arm-none-eabi cmake ninja-build unzip python3 git

COPY --from=docker_cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=esp_idf /opt/esp /opt/esp

WORKDIR /source
COPY firmware-adapters /opt/stmweb/adapters
CMD ["sh"]
