#include "stm32f10x.h"
#include "stmweb_boot_protocol.h"

#include <stdint.h>

#define STMWEB_BOOT_REQUEST 0xB007u
#define STMWEB_FACTORY_MAGIC 0x31574653u
#define STMWEB_APPLICATION_MAGIC 0x31505753u
#ifndef STMWEB_APP_BASE
#define STMWEB_APP_BASE 0x08004000u
#endif
#ifndef STMWEB_APP_LIMIT
#define STMWEB_APP_LIMIT 0x0801FC00u
#endif
#ifndef STMWEB_METADATA_ADDRESS
#define STMWEB_METADATA_ADDRESS STMWEB_APP_LIMIT
#endif
#ifndef STMWEB_EXPECTED_FLASH_KB
#define STMWEB_EXPECTED_FLASH_KB 128u
#endif
#define STMWEB_FLASH_PAGE_SIZE 1024u
#define STMWEB_FLASH_SIZE_REGISTER 0x1FFFF7E0u
#define STMWEB_STM32F103_MEDIUM_DEVICE_ID 0x410u

#define FLASH_KEY1 0x45670123u
#define FLASH_KEY2 0xCDEF89ABu
typedef struct {
  uint32_t magic;
  uint32_t size;
  uint32_t crc32;
  uint32_t check;
} StmwebApplicationMetadata;

__attribute__((section(".factory_metadata"), used))
const StmwebApplicationMetadata stmwebFactoryMetadata = {
  STMWEB_FACTORY_MAGIC,
  0xffffffffu,
  0xffffffffu,
  ~STMWEB_FACTORY_MAGIC,
};

static uint8_t receiveBuffer[sizeof(StmwebBootFrameHeader) + STMWEB_BOOT_MAX_PAYLOAD + 4u];
static uint32_t expectedSize;
static uint32_t expectedCrc;
static uint32_t nextOffset;
static uint8_t updateActive;

static uint32_t readU32(const uint8_t *bytes) {
  return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) | ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
}

static void writeU32(uint8_t *bytes, uint32_t value) {
  bytes[0] = (uint8_t)value;
  bytes[1] = (uint8_t)(value >> 8);
  bytes[2] = (uint8_t)(value >> 16);
  bytes[3] = (uint8_t)(value >> 24);
}

static uint32_t crc32Update(uint32_t crc, const uint8_t *bytes, uint32_t length) {
  while (length-- > 0u) {
    crc ^= *bytes++;
    for (uint8_t bit = 0; bit < 8u; bit++) crc = (crc >> 1) ^ (0xedb88320u & (0u - (crc & 1u)));
  }
  return crc;
}

static uint32_t crc32(const uint8_t *bytes, uint32_t length) {
  return crc32Update(0xffffffffu, bytes, length) ^ 0xffffffffu;
}

static void uartInit(void) {
  RCC->APB2ENR |= 1u << 3;
  RCC->APB1ENR |= 1u << 18;
  GPIOB->CRH = (GPIOB->CRH & ~0x0000ff00u) | 0x00004b00u;
  USART3->BRR = 0x0138u;
  USART3->CR1 = (1u << 13) | (1u << 3) | (1u << 2);
}

static void uartWriteByte(uint8_t value) {
  while ((USART3->SR & (1u << 7)) == 0u) {}
  USART3->DR = value;
}

static uint8_t uartReadByte(void) {
  while ((USART3->SR & (1u << 5)) == 0u) {}
  return (uint8_t)USART3->DR;
}

static void uartWrite(const uint8_t *bytes, uint32_t length) {
  while (length-- > 0u) uartWriteByte(*bytes++);
  while ((USART3->SR & (1u << 6)) == 0u) {}
}

static void sendResponse(uint8_t command, uint16_t sequence, uint32_t status, const uint8_t *payload, uint16_t length) {
  uint8_t frame[sizeof(StmwebBootFrameHeader) + 20u + 4u];
  StmwebBootFrameHeader *header = (StmwebBootFrameHeader *)frame;
  header->magic = STMWEB_BOOT_FRAME_MAGIC;
  header->version = STMWEB_BOOT_PROTOCOL_VERSION;
  header->command = command | 0x80u;
  header->sequence = sequence;
  header->offset = status;
  header->length = length;
  for (uint16_t index = 0; index < length; index++) frame[sizeof(*header) + index] = payload[index];
  writeU32(frame + sizeof(*header) + length, crc32(frame, sizeof(*header) + length));
  uartWrite(frame, sizeof(*header) + length + 4u);
}

static void flashWait(void) {
  while ((FLASH->SR & FLASH_SR_BSY) != 0u) {}
}

static uint8_t flashFinish(void) {
  flashWait();
  const uint32_t errors = FLASH->SR & (FLASH_SR_PGERR | FLASH_SR_WRPRTERR);
  FLASH->SR = FLASH_SR_EOP | FLASH_SR_PGERR | FLASH_SR_WRPRTERR;
  return errors == 0u;
}

static void flashUnlock(void) {
  if ((FLASH->CR & FLASH_CR_LOCK) != 0u) {
    FLASH->KEYR = FLASH_KEY1;
    FLASH->KEYR = FLASH_KEY2;
  }
}

static uint8_t flashErasePage(uint32_t address) {
  flashWait();
  FLASH->CR |= FLASH_CR_PER;
  FLASH->AR = address;
  FLASH->CR |= FLASH_CR_STRT;
  const uint8_t ok = flashFinish();
  FLASH->CR &= ~FLASH_CR_PER;
  return ok;
}

static uint8_t flashProgram(uint32_t address, const uint8_t *bytes, uint16_t length) {
  FLASH->CR |= FLASH_CR_PG;
  for (uint16_t index = 0; index < length; index += 2u) {
    uint16_t value = bytes[index];
    if (index + 1u < length) value |= (uint16_t)bytes[index + 1u] << 8;
    else value |= 0xff00u;
    *(volatile uint16_t *)(address + index) = value;
    if (!flashFinish() || *(volatile uint16_t *)(address + index) != value) {
      FLASH->CR &= ~FLASH_CR_PG;
      return 0u;
    }
  }
  FLASH->CR &= ~FLASH_CR_PG;
  return 1u;
}

static uint8_t vectorLooksValid(void) {
  const uint32_t stack = *(volatile uint32_t *)STMWEB_APP_BASE;
  const uint32_t reset = *(volatile uint32_t *)(STMWEB_APP_BASE + 4u);
  return stack >= 0x20000000u && stack <= 0x20005000u && reset >= STMWEB_APP_BASE && reset < STMWEB_APP_LIMIT && (reset & 1u) != 0u;
}

static uint8_t applicationLooksValid(void) {
  const StmwebApplicationMetadata *metadata = (const StmwebApplicationMetadata *)STMWEB_METADATA_ADDRESS;
  if (!vectorLooksValid() || metadata->check != ~metadata->magic) return 0u;
  if (metadata->magic == STMWEB_FACTORY_MAGIC) return 1u;
  if (metadata->magic != STMWEB_APPLICATION_MAGIC || metadata->size == 0u || metadata->size > STMWEB_APP_LIMIT - STMWEB_APP_BASE) return 0u;
  return crc32((const uint8_t *)STMWEB_APP_BASE, metadata->size) == metadata->crc32;
}

static void clearBootRequest(void) {
  RCC->APB1ENR |= (1u << 27) | (1u << 28);
  PWR->CR |= PWR_CR_DBP;
  BKP->DR1 = 0u;
}

static uint8_t hasBootRequest(void) {
  RCC->APB1ENR |= (1u << 27) | (1u << 28);
  PWR->CR |= PWR_CR_DBP;
  return BKP->DR1 == STMWEB_BOOT_REQUEST;
}

__attribute__((noreturn)) static void runApplication(void) {
  const uint32_t stack = *(volatile uint32_t *)STMWEB_APP_BASE;
  const uint32_t reset = *(volatile uint32_t *)(STMWEB_APP_BASE + 4u);
  __disable_irq();
  USART3->CR1 = 0u;
  SCB->VTOR = STMWEB_APP_BASE;
  __asm volatile("msr msp, %0" : : "r"(stack) : "memory");
  __enable_irq();
  ((void (*)(void))reset)();
  for (;;) {}
}

static uint32_t beginUpdate(const uint8_t *payload, uint16_t length) {
  if (length != 8u) return STMWEB_BOOT_STATUS_BAD_FRAME;
  if (*(volatile uint16_t *)STMWEB_FLASH_SIZE_REGISTER != STMWEB_EXPECTED_FLASH_KB) return STMWEB_BOOT_STATUS_BAD_TARGET;
  expectedSize = readU32(payload);
  expectedCrc = readU32(payload + 4u);
  if (expectedSize == 0u || expectedSize > STMWEB_APP_LIMIT - STMWEB_APP_BASE) return STMWEB_BOOT_STATUS_BAD_TARGET;
  flashUnlock();
  if (!flashErasePage(STMWEB_METADATA_ADDRESS)) return STMWEB_BOOT_STATUS_FLASH_ERROR;
  const uint32_t eraseEnd = STMWEB_APP_BASE + ((expectedSize + STMWEB_FLASH_PAGE_SIZE - 1u) & ~(STMWEB_FLASH_PAGE_SIZE - 1u));
  for (uint32_t address = STMWEB_APP_BASE; address < eraseEnd; address += STMWEB_FLASH_PAGE_SIZE) {
    if (!flashErasePage(address)) return STMWEB_BOOT_STATUS_FLASH_ERROR;
  }
  expectedCrc = readU32(payload + 4u);
  nextOffset = 0u;
  updateActive = 1u;
  return STMWEB_BOOT_STATUS_OK;
}

static uint32_t writeChunk(uint32_t offset, const uint8_t *payload, uint16_t length) {
  if (!updateActive) return STMWEB_BOOT_STATUS_BAD_STATE;
  if (offset < nextOffset && offset + length == nextOffset) {
    for (uint16_t index = 0; index < length; index++) {
      if (*(volatile uint8_t *)(STMWEB_APP_BASE + offset + index) != payload[index]) return STMWEB_BOOT_STATUS_BAD_OFFSET;
    }
    return STMWEB_BOOT_STATUS_OK;
  }
  if (offset != nextOffset || length == 0u || length > STMWEB_BOOT_MAX_PAYLOAD || offset + length > expectedSize) return STMWEB_BOOT_STATUS_BAD_OFFSET;
  if ((offset & 1u) != 0u || ((length & 1u) != 0u && offset + length != expectedSize)) return STMWEB_BOOT_STATUS_BAD_OFFSET;
  if (!flashProgram(STMWEB_APP_BASE + offset, payload, length)) return STMWEB_BOOT_STATUS_FLASH_ERROR;
  nextOffset += length;
  return STMWEB_BOOT_STATUS_OK;
}

static uint32_t finishUpdate(void) {
  if (!updateActive || nextOffset != expectedSize) return STMWEB_BOOT_STATUS_BAD_STATE;
  if (crc32((const uint8_t *)STMWEB_APP_BASE, expectedSize) != expectedCrc || !vectorLooksValid()) return STMWEB_BOOT_STATUS_VERIFY_ERROR;
  const StmwebApplicationMetadata metadata = { STMWEB_APPLICATION_MAGIC, expectedSize, expectedCrc, ~STMWEB_APPLICATION_MAGIC };
  if (!flashProgram(STMWEB_METADATA_ADDRESS, (const uint8_t *)&metadata, sizeof(metadata))) return STMWEB_BOOT_STATUS_FLASH_ERROR;
  FLASH->CR |= FLASH_CR_LOCK;
  updateActive = 0u;
  clearBootRequest();
  return STMWEB_BOOT_STATUS_OK;
}

static void handleFrame(const StmwebBootFrameHeader *header, const uint8_t *payload) {
  uint32_t status = STMWEB_BOOT_STATUS_BAD_FRAME;
  uint8_t info[20];
  uint16_t infoLength = 0u;
  if (header->command == STMWEB_BOOT_COMMAND_HELLO) {
    writeU32(info, (uint32_t)*(volatile uint16_t *)STMWEB_FLASH_SIZE_REGISTER * 1024u);
    writeU32(info + 4u, STMWEB_APP_BASE);
    writeU32(info + 8u, STMWEB_APP_LIMIT - STMWEB_APP_BASE);
    writeU32(info + 12u, applicationLooksValid());
    writeU32(info + 16u, STMWEB_STM32F103_MEDIUM_DEVICE_ID);
    infoLength = sizeof(info);
    status = STMWEB_BOOT_STATUS_OK;
  } else if (header->command == STMWEB_BOOT_COMMAND_BEGIN) {
    status = beginUpdate(payload, header->length);
  } else if (header->command == STMWEB_BOOT_COMMAND_DATA) {
    status = writeChunk(header->offset, payload, header->length);
  } else if (header->command == STMWEB_BOOT_COMMAND_END) {
    status = finishUpdate();
  } else if (header->command == STMWEB_BOOT_COMMAND_ABORT) {
    updateActive = 0u;
    status = STMWEB_BOOT_STATUS_OK;
  } else if (header->command == STMWEB_BOOT_COMMAND_RUN) {
    status = applicationLooksValid() ? STMWEB_BOOT_STATUS_OK : STMWEB_BOOT_STATUS_NO_APPLICATION;
  }
  sendResponse(header->command, header->sequence, status, info, infoLength);
  if (header->command == STMWEB_BOOT_COMMAND_END && status == STMWEB_BOOT_STATUS_OK) NVIC_SystemReset();
  if (header->command == STMWEB_BOOT_COMMAND_RUN && status == STMWEB_BOOT_STATUS_OK) runApplication();
}

static void receiveFrames(uint16_t used) {
  uint16_t required = sizeof(StmwebBootFrameHeader);
  for (;;) {
    receiveBuffer[used++] = uartReadByte();
    if (used == 4u && readU32(receiveBuffer) != STMWEB_BOOT_FRAME_MAGIC) {
      receiveBuffer[0] = receiveBuffer[1]; receiveBuffer[1] = receiveBuffer[2]; receiveBuffer[2] = receiveBuffer[3];
      used = 3u;
      continue;
    }
    if (used == sizeof(StmwebBootFrameHeader)) {
      const StmwebBootFrameHeader *header = (const StmwebBootFrameHeader *)receiveBuffer;
      if (header->magic != STMWEB_BOOT_FRAME_MAGIC || header->version != STMWEB_BOOT_PROTOCOL_VERSION || header->length > STMWEB_BOOT_MAX_PAYLOAD) {
        used = 0u; required = sizeof(StmwebBootFrameHeader); continue;
      }
      required = sizeof(StmwebBootFrameHeader) + header->length + 4u;
    }
    if (used == required) {
      const StmwebBootFrameHeader *header = (const StmwebBootFrameHeader *)receiveBuffer;
      const uint32_t receivedCrc = readU32(receiveBuffer + required - 4u);
      if (crc32(receiveBuffer, required - 4u) == receivedCrc) handleFrame(header, receiveBuffer + sizeof(*header));
      else sendResponse(header->command, header->sequence, STMWEB_BOOT_STATUS_BAD_FRAME, 0, 0u);
      used = 0u;
      required = sizeof(StmwebBootFrameHeader);
    }
  }
}

int main(void) {
  uartInit();
  if (!hasBootRequest() && applicationLooksValid()) {
    uint16_t syncBytes = 0u;
    for (volatile uint32_t wait = 0; wait < 9000000u; wait++) {
      if ((USART3->SR & (1u << 5)) != 0u) {
        receiveBuffer[syncBytes++] = (uint8_t)USART3->DR;
        if (syncBytes == 4u) {
          if (readU32(receiveBuffer) == STMWEB_BOOT_FRAME_MAGIC) receiveFrames(4u);
          receiveBuffer[0] = receiveBuffer[1];
          receiveBuffer[1] = receiveBuffer[2];
          receiveBuffer[2] = receiveBuffer[3];
          syncBytes = 3u;
        }
      }
    }
    runApplication();
  }
  receiveFrames(0u);
}
