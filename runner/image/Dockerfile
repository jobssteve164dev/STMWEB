FROM docker:27-cli AS docker_cli

FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc-arm-none-eabi libnewlib-arm-none-eabi cmake ninja-build unzip

COPY --from=docker_cli /usr/local/bin/docker /usr/local/bin/docker

WORKDIR /source
COPY firmware-adapters/dot-v1 /opt/stmweb/adapters/dot-v1
CMD ["sh"]
