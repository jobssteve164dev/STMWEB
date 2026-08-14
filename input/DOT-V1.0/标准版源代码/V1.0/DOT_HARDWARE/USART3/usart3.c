#include "usart3.h"

void uart3_init(u32 bound)
{  	 
	  //GPIO端口设置
  GPIO_InitTypeDef GPIO_InitStructure;
	USART_InitTypeDef USART_InitStructure;
	NVIC_InitTypeDef NVIC_InitStructure;
	 
	RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOB, ENABLE);	//使能UGPIOB时钟
  RCC_APB1PeriphClockCmd(RCC_APB1Periph_USART3, ENABLE);	//使能USART3时钟
	//USART3_TX  
  GPIO_InitStructure.GPIO_Pin = GPIO_Pin_10; //PB.10
  GPIO_InitStructure.GPIO_Speed = GPIO_Speed_50MHz;
  GPIO_InitStructure.GPIO_Mode = GPIO_Mode_AF_PP;	//复用推挽输出
  GPIO_Init(GPIOB, &GPIO_InitStructure);
   
  //USART3_RX	  
  GPIO_InitStructure.GPIO_Pin = GPIO_Pin_11;//PB11
  GPIO_InitStructure.GPIO_Mode = GPIO_Mode_IN_FLOATING;//浮空输入
  GPIO_Init(GPIOB, &GPIO_InitStructure);

  //Usart3 NVIC 配置
  NVIC_InitStructure.NVIC_IRQChannel = USART3_IRQn;
	NVIC_InitStructure.NVIC_IRQChannelPreemptionPriority=0 ;//抢占优先级
	NVIC_InitStructure.NVIC_IRQChannelSubPriority = 1;		//子优先级
	NVIC_InitStructure.NVIC_IRQChannelCmd = ENABLE;			//IRQ通道使能
	NVIC_Init(&NVIC_InitStructure);	//根据指定的参数初始化VIC寄存器
   //USART 初始化设置
	USART_InitStructure.USART_BaudRate = bound;//串口波特率
	USART_InitStructure.USART_WordLength = USART_WordLength_8b;//字长为8位数据格式
	USART_InitStructure.USART_StopBits = USART_StopBits_1;//一个停止位
	USART_InitStructure.USART_Parity = USART_Parity_No;//无奇偶校验位
	USART_InitStructure.USART_HardwareFlowControl = USART_HardwareFlowControl_None;//无硬件数据流控制
	USART_InitStructure.USART_Mode = USART_Mode_Rx | USART_Mode_Tx;	//收发模式
  USART_Init(USART3, &USART_InitStructure);     //初始化串口3
  USART_ITConfig(USART3, USART_IT_RXNE, ENABLE);//开启串口接受中断
  USART_Cmd(USART3, ENABLE);                    //使能串口3 

}

char RX_buf[20]={0};
u8 cnt=0,cntPre=0; 

s16 remot_moto=0;
s16 remot_angle=0;

void RX_buf_Clear(void)  //	清空缓存
{
	memset(RX_buf, 0, sizeof(RX_buf));
	cnt = 0;
}

_Bool RX_WaitRecive(void)//等待接收完成 返回参数：	REV_OK-接收完成		REV_WAIT-接收超时未完成	说明：循环调用检测是否接收完成
{
	if(cnt == 0)return 1; 							//如果接收计数为0 则说明没有处于接收数据中，所以直接跳出，结束函数
	if(cnt == cntPre)				//如果上一次的值和这次相同，则说明接收完毕
	{
		cnt = 0;							//清0接收计数
		return 0;								//返回接收完成标志
	}
	cntPre = cnt;					//置为相同
	return 1;								//返回接收未完成标志
}

void strmcpy(char* t, int m, char* s)
{
	char len, i = 0;
	len = strlen(t);//得到长度
	if (m <= len)
	{
		for (i = 0; *(t + i) != 0; i++)//将输入字符串t中从第m个字符开始的全部字符复制到字符串s中
		{
			*(s + i) = *(t + m - 1 + i);//这里-1是为了符合题目要求，题目要求从第m个字符开始，要包括第m个字符
		}
	}
    else//若m超过输入字符串的长度，则结果字符串应为空串
    {   
        *s='\0';
    }
}

void usart3_send(u8 data) /*usart1发送一个字节****/
{
	USART3->DR = data;
	while((USART3->SR&0x40)==0);	
}

void Usart3_SendString(unsigned char *str, unsigned short len)  //串口数据发送 入口参数：	USARTx：串口组 str：要发送的数据  len：数据长度
{
	unsigned short count = 0;
	for(; count < len; count++)
	{
		usart3_send(*str++);									//发送数据
	}
}


void communication(void)        //与上位机交互 
{
	
 if(RX_WaitRecive() == 0)							//收到数据
	 {
		  char var_temp[10];
		  if(strstr((const char *)RX_buf, "f:")!= NULL)           //运动指令        
			{
				if(RX_buf[2]=='-')  //油门为负值
				 {
					 if(RX_buf[9]=='-')               //方向为负值
					 {
						 remot_angle=(-(RX_buf[10]-0x30)*100-(RX_buf[12]-0x30)*10-(RX_buf[13]-0x30))/8;
				     remot_moto=(-(RX_buf[3]-0x30)*100-(RX_buf[5]-0x30)*10-(RX_buf[6]-0x30))/8;
					 }
					 else  if(RX_buf[9]>0x29&&RX_buf[9]<0x40)             //方向为正值
					 {
						  remot_angle=((RX_buf[9]-0x30)*100+(RX_buf[11]-0x30)*10+(RX_buf[12]-0x30))/8;
				      remot_moto=(-(RX_buf[3]-0x30)*100-(RX_buf[5]-0x30)*10-(RX_buf[6]-0x30))/8;
					 }
					 else
					 {
						 remot_angle=0;
						 remot_moto=0;
					 }
				 }
				 else  if(RX_buf[2]>0x29&&RX_buf[2]<0x40)                      //油门为正值
				 {
					  if(RX_buf[8]=='-')               //方向为负值
					 {
						 remot_angle=(-(RX_buf[9]-0x30)*100-(RX_buf[11]-0x30)*10-(RX_buf[12]-0x30))/8;
				     remot_moto=((RX_buf[2]-0x30)*100+(RX_buf[4]-0x30)*10+(RX_buf[5]-0x30))/8;
					 }
					 else if(RX_buf[8]>0x29&&RX_buf[8]<0x40)               //方向为正值
					 {
						 remot_angle=((RX_buf[8]-0x30)*100+(RX_buf[10]-0x30)*10+(RX_buf[11]-0x30))/8;
				     remot_moto=((RX_buf[2]-0x30)*100+(RX_buf[4]-0x30)*10+(RX_buf[5]-0x30))/8;
					 }
					 else
					 {
						  remot_angle=0;
						  remot_moto=0;
					 }
				 }
				 else
				 {
					    remot_angle=0;
						  remot_moto=0; 
				 }
				 if(remot_moto>120)remot_moto=120;
				 if(remot_moto<-120)remot_moto=-120;
				 if(remot_angle>120)remot_angle=120;
				 if(remot_angle<-120)remot_angle=-120;
			}
			else if(strstr((const char *)RX_buf, "B_KP_y:")!= NULL)   		
			{
				strmcpy( RX_buf,8, var_temp );      //从第8个字节开始复制到var_temp中
				Balance_Kp=strtod(var_temp,NULL);  //将var_temp转换为浮点型数字
			}
			else if(strstr((const char *)RX_buf, "B_KI_y:")!= NULL)
			{
				strmcpy( RX_buf,8, var_temp );      //从第13个字节开始复制到var_temp中
				//Balance_KI_x=strtod(var_temp,NULL);  //将var_temp转换为浮点型数字
			}
			else if(strstr((const char *)RX_buf, "B_KD_y:")!= NULL)
			{
				strmcpy( RX_buf,8, var_temp );      //从第13个字节开始复制到var_temp中
				Balance_Kd=strtod(var_temp,NULL);  //将var_temp转换为浮点型数字
			}
			else if(strstr((const char *)RX_buf, "S_KP_y:")!= NULL)
			{
				strmcpy( RX_buf,8, var_temp );      //从第13个字节开始复制到var_temp中
				Velocity_Kp=strtod(var_temp,NULL);  //将var_temp转换为浮点型数字
			}
			else if(strstr((const char *)RX_buf, "S_KI_y:")!= NULL)
			{
				strmcpy( RX_buf,8, var_temp );      //从第13个字节开始复制到var_temp中
				Velocity_Ki=strtod(var_temp,NULL);  //将var_temp转换为浮点型数字
			}
			else if(strstr((const char *)RX_buf, "S_KD_y:")!= NULL)
			{
				strmcpy( RX_buf,8, var_temp );      //从第13个字节开始复制到var_temp中
				//Speed_KD_x=strtod(var_temp,NULL);  //将var_temp转换为浮点型数字
			}
			RX_buf_Clear();
		}
}


void USART3_IRQHandler(void)
{	
	if(USART_GetITStatus(USART3, USART_IT_RXNE) != RESET) //接收到数据
	{	  
		if(cnt >= 20)cnt = 0; //防止串口被刷爆	
  	RX_buf[cnt]=USART_ReceiveData(USART3); 
		cnt++;	
		 
	}  											 
} 

