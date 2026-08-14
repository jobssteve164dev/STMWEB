#ifndef __USRAT2_H
#define __USRAT2_H 
#include "sys.h"	  	

void uart2_init(u32 pclk2,u32 bound);

void usart2_send(u8 data); /*usart1发送一个字节****/

void Usart2_SendString(unsigned char *str, unsigned short len);  //串口数据发送 入口参数：	USARTx：串口组 str：要发送的数据  len：数据长度

void USART2_IRQHandler(void);

#endif



