#ifndef __USRAT3_H
#define __USRAT3_H 
#include "sys.h"	  	
extern u8 Usart3_Receive;
void uart3_init(u32 bound);

void usart3_send(u8 data); /*usart1发送一个字节****/

void Usart3_SendString(unsigned char *str, unsigned short len);  //串口数据发送 入口参数：	USARTx：串口组 str：要发送的数据  len：数据长度

void communication(void);

void USART3_IRQHandler(void);
#endif

