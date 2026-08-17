.syntax unified
.cpu cortex-m3
.thumb

.global g_pfnVectors
.global Reset_Handler

.section .isr_vector,"a",%progbits
.type g_pfnVectors, %object
g_pfnVectors:
  .word _estack
  .word Reset_Handler
  .word NMI_Handler
  .word HardFault_Handler
  .word MemManage_Handler
  .word BusFault_Handler
  .word UsageFault_Handler
  .word 0, 0, 0, 0
  .word SVC_Handler
  .word DebugMon_Handler
  .word 0
  .word PendSV_Handler
  .word SysTick_Handler
  .word WWDG_IRQHandler, PVD_IRQHandler, TAMPER_IRQHandler, RTC_IRQHandler
  .word FLASH_IRQHandler, RCC_IRQHandler, EXTI0_IRQHandler, EXTI1_IRQHandler
  .word EXTI2_IRQHandler, EXTI3_IRQHandler, EXTI4_IRQHandler
  .word DMA1_Channel1_IRQHandler, DMA1_Channel2_IRQHandler, DMA1_Channel3_IRQHandler
  .word DMA1_Channel4_IRQHandler, DMA1_Channel5_IRQHandler, DMA1_Channel6_IRQHandler
  .word DMA1_Channel7_IRQHandler, ADC1_2_IRQHandler, USB_HP_CAN1_TX_IRQHandler
  .word USB_LP_CAN1_RX0_IRQHandler, CAN1_RX1_IRQHandler, CAN1_SCE_IRQHandler
  .word EXTI9_5_IRQHandler, TIM1_BRK_IRQHandler, TIM1_UP_IRQHandler
  .word TIM1_TRG_COM_IRQHandler, TIM1_CC_IRQHandler, TIM2_IRQHandler
  .word TIM3_IRQHandler, TIM4_IRQHandler, I2C1_EV_IRQHandler, I2C1_ER_IRQHandler
  .word I2C2_EV_IRQHandler, I2C2_ER_IRQHandler, SPI1_IRQHandler, SPI2_IRQHandler
  .word USART1_IRQHandler, USART2_IRQHandler, USART3_IRQHandler
  .word EXTI15_10_IRQHandler, RTCAlarm_IRQHandler, USBWakeUp_IRQHandler
.size g_pfnVectors, .-g_pfnVectors

.section .text.Reset_Handler,"ax",%progbits
.type Reset_Handler, %function
Reset_Handler:
  ldr r0, =_sidata
  ldr r1, =_sdata
  ldr r2, =_edata
1: cmp r1, r2
  ittt lt
  ldrlt r3, [r0], #4
  strlt r3, [r1], #4
  blt 1b
  ldr r1, =_sbss
  ldr r2, =_ebss
  movs r3, #0
2: cmp r1, r2
  itt lt
  strlt r3, [r1], #4
  blt 2b
  bl SystemInit
  ldr r0, =_flash_start
  ldr r1, =0xE000ED08
  str r0, [r1]
  dsb
  isb
  bl main
3: b 3b
.size Reset_Handler, .-Reset_Handler

.section .text.Default_Handler,"ax",%progbits
Default_Handler: b Default_Handler

.macro weak_handler name
  .weak \name
  .thumb_set \name, Default_Handler
.endm

weak_handler NMI_Handler
weak_handler HardFault_Handler
weak_handler MemManage_Handler
weak_handler BusFault_Handler
weak_handler UsageFault_Handler
weak_handler SVC_Handler
weak_handler DebugMon_Handler
weak_handler PendSV_Handler
weak_handler SysTick_Handler
weak_handler WWDG_IRQHandler
weak_handler PVD_IRQHandler
weak_handler TAMPER_IRQHandler
weak_handler RTC_IRQHandler
weak_handler FLASH_IRQHandler
weak_handler RCC_IRQHandler
weak_handler EXTI0_IRQHandler
weak_handler EXTI1_IRQHandler
weak_handler EXTI2_IRQHandler
weak_handler EXTI3_IRQHandler
weak_handler EXTI4_IRQHandler
weak_handler DMA1_Channel1_IRQHandler
weak_handler DMA1_Channel2_IRQHandler
weak_handler DMA1_Channel3_IRQHandler
weak_handler DMA1_Channel4_IRQHandler
weak_handler DMA1_Channel5_IRQHandler
weak_handler DMA1_Channel6_IRQHandler
weak_handler DMA1_Channel7_IRQHandler
weak_handler ADC1_2_IRQHandler
weak_handler USB_HP_CAN1_TX_IRQHandler
weak_handler USB_LP_CAN1_RX0_IRQHandler
weak_handler CAN1_RX1_IRQHandler
weak_handler CAN1_SCE_IRQHandler
weak_handler EXTI9_5_IRQHandler
weak_handler TIM1_BRK_IRQHandler
weak_handler TIM1_UP_IRQHandler
weak_handler TIM1_TRG_COM_IRQHandler
weak_handler TIM1_CC_IRQHandler
weak_handler TIM2_IRQHandler
weak_handler TIM3_IRQHandler
weak_handler TIM4_IRQHandler
weak_handler I2C1_EV_IRQHandler
weak_handler I2C1_ER_IRQHandler
weak_handler I2C2_EV_IRQHandler
weak_handler I2C2_ER_IRQHandler
weak_handler SPI1_IRQHandler
weak_handler SPI2_IRQHandler
weak_handler USART1_IRQHandler
weak_handler USART2_IRQHandler
weak_handler USART3_IRQHandler
weak_handler EXTI15_10_IRQHandler
weak_handler RTCAlarm_IRQHandler
weak_handler USBWakeUp_IRQHandler
