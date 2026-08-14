#include "stm32f10x.h"
#include "sys.h"

void MY_NVIC_SetVectorTable(u32 base, u32 offset) { SCB->VTOR = base | (offset & 0x1FFFFF80u); }

void MY_NVIC_PriorityGroupConfig(u8 group) {
  u32 value = SCB->AIRCR & 0x0000F8FFu;
  value |= 0x05FA0000u | (((~group) & 0x07u) << 8);
  SCB->AIRCR = value;
}

void MY_NVIC_Init(u8 preemption, u8 sub, u8 channel, u8 group) {
  u32 priority;
  MY_NVIC_PriorityGroupConfig(group);
  priority = (preemption << (4u - group)) | (sub & (0x0fu >> group));
  NVIC->ISER[channel / 32u] |= 1u << (channel % 32u);
  NVIC->IP[channel] |= (priority & 0x0fu) << 4;
}

void Ex_NVIC_Config(u8 gpio, u8 bit, u8 trigger) {
  const u8 registerIndex = bit / 4u;
  const u8 shift = (bit % 4u) * 4u;
  RCC->APB2ENR |= 1u;
  AFIO->EXTICR[registerIndex] = (AFIO->EXTICR[registerIndex] & ~(0x0fu << shift)) | (gpio << shift);
  EXTI->IMR |= 1u << bit;
  if (trigger & 0x01u) EXTI->FTSR |= 1u << bit;
  if (trigger & 0x02u) EXTI->RTSR |= 1u << bit;
}

void WFI_SET(void) { __asm volatile("wfi"); }
void INTX_DISABLE(void) { __asm volatile("cpsid i" ::: "memory"); }
void INTX_ENABLE(void) { __asm volatile("cpsie i" ::: "memory"); }
void MSR_MSP(u32 address) { __asm volatile("msr msp, %0" : : "r"(address) : "memory"); }

void MYRCC_DeInit(void) {
  RCC->APB1RSTR = 0; RCC->APB2RSTR = 0; RCC->AHBENR = 0x14;
  RCC->APB2ENR = 0; RCC->APB1ENR = 0; RCC->CR |= 1u;
  RCC->CFGR &= 0xF8FF0000u; RCC->CR &= 0xFEF6FFFFu;
  RCC->CR &= 0xFFFBFFFFu; RCC->CFGR &= 0xFF80FFFFu; RCC->CIR = 0;
  MY_NVIC_SetVectorTable(0x08000000u, 0);
}

void Sys_Standby(void) {
  SCB->SCR |= 1u << 2; RCC->APB1ENR |= 1u << 28; PWR->CSR |= 1u << 8;
  PWR->CR |= (1u << 2) | (1u << 1); WFI_SET();
}

void Sys_Soft_Reset(void) { SCB->AIRCR = 0x05FA0004u; }

void JTAG_Set(u8 mode) {
  RCC->APB2ENR |= 1u;
  AFIO->MAPR = (AFIO->MAPR & 0xF8FFFFFFu) | ((u32)mode << 25);
}

void Stm32_Clock_Init(u8 pll) {
  u8 status = 0;
  MYRCC_DeInit(); RCC->CR |= 0x00010000u;
  while (!(RCC->CR >> 17)) {}
  RCC->CFGR = 0x00000400u | ((u32)(pll - 2u) << 18) | (1u << 16);
  FLASH->ACR |= 0x32u; RCC->CR |= 0x01000000u;
  while (!(RCC->CR >> 25)) {}
  RCC->CFGR |= 2u;
  while (status != 2u) { status = (RCC->CFGR >> 2) & 3u; }
}
