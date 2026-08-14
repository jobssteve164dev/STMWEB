#include "key.h"
void KEY_Init(void)
{
  GPIO_InitTypeDef GPIO_InitStructure;
	RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOB, ENABLE); //使能PA端口时钟
  GPIO_InitStructure.GPIO_Pin = GPIO_Pin_8;	            //端口配置
  GPIO_InitStructure.GPIO_Mode = GPIO_Mode_IPU;         //上拉输入
  GPIO_Init(GPIOB, &GPIO_InitStructure);					      //根据设定参数初始化GPIOA 
} 

u8 key_read(void) /*按键扫描入口参数：双击等待时间返回  值：按键状态 0：无动作 1：单击 2：双击 */
{
	  if(KEY==0)return 1;        //长按标志位未置1
		else return 0;
}

