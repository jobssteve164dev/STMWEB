FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc-arm-none-eabi libnewlib-arm-none-eabi cmake ninja-build

WORKDIR /source
COPY firmware-adapters/dot-v1 /opt/stmweb/adapters/dot-v1
CMD ["sh"]
