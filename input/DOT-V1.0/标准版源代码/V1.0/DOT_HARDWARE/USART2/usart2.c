#include "usart2.h"

void uart2_init(u32 pclk2,u32 bound)
{    
    float temp;
    u16 mantissa;
    u16 fraction;      
    temp=(float)(pclk2*1000000)/(bound*16);//得到USARTDIV
    mantissa=temp;               //得到整数部分
    fraction=(temp-mantissa)*16; //得到小数部分    
    mantissa<<=4;
    mantissa+=fraction;  
    RCC->APB2ENR|=1<<2;   //使能PORTA口时钟  //RCC->APB2ENR 见中文参考手册 p70  port A - G的时钟使能 分别在第2-8位，USART1在14位
    RCC->APB1ENR|=1<<17;  //使能串口时钟 //RCC->APB1ENR 见中文参考手册 p72  USART2-5的时钟使能 分别在第17-20位
    
    /*CRL & CRH
    中文参考手册p113
     每个io口4位，
    低两位是mode：
    00输入，01输出10MHz，10输出2MHz，11输出50MHz，
    高两位是CNF：00模拟输入，01浮空输入 。10上拉下拉输入，11保留  ，
    00：通用推挽输出模式
01：通用开漏输出模式
10：复用功能推挽输出模式
11：复用功能开漏输出模式

串口配置时，RX为1000，TX为1011
    */
    GPIOA->CRL&=0XFFFF00FF;  
    GPIOA->CRL|=0X00008B00;//IO状态设置
    
    /*ODR p115
    似乎可以不用配置
    端口输出数据（可用来配置上拉下拉）
    串口配置时，RX为上拉输入，对应位配置为1
    */
    GPIOA->ODR|=1<<3;     
    /*
    p67
    APB1RSTR 的 第17-20分别是串口2-5的复位
    */
    RCC->APB1RSTR|=1<<17;   //复位串口2
    RCC->APB1RSTR&=~(1<<17);//停止复位         
    //波特率设置
    USART2->BRR=mantissa; // 波特率设置   
    USART2->CR1|=0X200C;  //1位停止,无校验位.
    //使能接收中断
    USART2->CR1|=1<<8;    //PE中断使能
    USART2->CR1|=1<<5;    //接收缓冲区非空中断使能         
    MY_NVIC_Init(1,1,USART2_IRQn,2);//组2，最低优先级 
}
	
u8 USART_RX_BUF[20];     //接收缓冲,最大USART_REC_LEN个字节.
//接收状态
//bit15，	接收完成标志
//bit14，	接收到0x0d
//bit13~0，	接收到的有效字节数目
u16 USART_RX_STA=0;       //接收状态标记

void USART2_IRQHandler(void)   //蓝牙串口接收中断
{
	u8 res;	
	if(USART2->SR&(1<<5))//接收到数据
	{	 
 		res=USART2->DR; 
 		if((USART_RX_STA&0x8000)==0)//接收未完成
 		{
 			if(USART_RX_STA&0x4000)//接收到了0x0d
 			{
 				if(res!=0x0a)USART_RX_STA=0;//接收错误,重新开始
 				else  //接收完成了
        {
         USART_RX_STA|=0x8000;
				 //数据就在USART_RX_BUF中，用户可以在这里为所欲为
				 remot_angle=-((USART_RX_BUF[0]-0x30)*100+(USART_RX_BUF[1]-0x30)*10+(USART_RX_BUF[2]-0x30)-100)*3/4;
				 remot_moto=(USART_RX_BUF[3]-0x30)*4;
					if(remot_moto>14)remot_moto=14;
         USART_RX_STA=0;
        }	
 			}
 			else //还没收到0X0d
 			{	
 				if(res==0x0d)USART_RX_STA|=0x4000;
 				else
 				{
 					USART_RX_BUF[USART_RX_STA&0X3FFF]=res;
 					USART_RX_STA++;
 					if(USART_RX_STA>30)USART_RX_STA=0;//接收数据错误,重新开始接收	  
 				}		 
 			}
 		}  		 									     
	}
} 

