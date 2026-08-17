#include "stm32f10x.h"
#include "sys.h"
#include "usart3.h"

#include <string.h>

#define STMWEB_BOOT_REQUEST 0xB007u

extern char RX_buf[20];
extern u8 Flag_Stop;
extern void legacy_communication(void);

void communication(void) {
  if (strstr(RX_buf, "STMWEB:BOOT") != 0) {
    Flag_Stop = 1;
    Set_Pwm(0, 0);
    RCC->APB1ENR |= (1u << 27) | (1u << 28);
    PWR->CR |= PWR_CR_DBP;
    BKP->DR1 = STMWEB_BOOT_REQUEST;
    Usart3_SendString((unsigned char *)"STMWEB:BOOTING", 14);
    for (volatile uint32_t wait = 0; wait < 720000u; wait++) {}
    NVIC_SystemReset();
  }
  legacy_communication();
}
