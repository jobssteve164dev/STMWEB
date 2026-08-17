#pragma once

#include <stdint.h>

#define STMWEB_BOOT_FRAME_MAGIC 0x574D5453u
#define STMWEB_BOOT_PROTOCOL_VERSION 1u
#define STMWEB_BOOT_MAX_PAYLOAD 256u

#define STMWEB_BOOT_COMMAND_HELLO 0x01u
#define STMWEB_BOOT_COMMAND_BEGIN 0x02u
#define STMWEB_BOOT_COMMAND_DATA  0x03u
#define STMWEB_BOOT_COMMAND_END   0x04u
#define STMWEB_BOOT_COMMAND_ABORT 0x05u
#define STMWEB_BOOT_COMMAND_RUN   0x06u

#define STMWEB_BOOT_STATUS_OK             0u
#define STMWEB_BOOT_STATUS_BAD_FRAME      1u
#define STMWEB_BOOT_STATUS_BAD_STATE      2u
#define STMWEB_BOOT_STATUS_BAD_TARGET     3u
#define STMWEB_BOOT_STATUS_BAD_OFFSET     4u
#define STMWEB_BOOT_STATUS_FLASH_ERROR    5u
#define STMWEB_BOOT_STATUS_VERIFY_ERROR   6u
#define STMWEB_BOOT_STATUS_NO_APPLICATION 7u

typedef struct __attribute__((packed)) {
  uint32_t magic;
  uint8_t version;
  uint8_t command;
  uint16_t sequence;
  uint32_t offset;
  uint16_t length;
} StmwebBootFrameHeader;
