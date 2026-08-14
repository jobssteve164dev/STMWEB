FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc-arm-none-eabi libnewlib-arm-none-eabi cmake ninja-build

WORKDIR /source
CMD ["sh"]
