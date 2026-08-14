#include "vl53l0x_it.h"
#include "stm32f10x_exti.h"
#include "misc.h"

//上下限距离值 单位:mm
#define Thresh_Low  60
#define Thresh_High 150

//中断模式参数结构体
typedef struct 
{
   const int VL53L0X_Mode;//模式
	 uint32_t ThreshLow;    //下限值
	 uint32_t ThreshHigh;   //上限值
}AlrmMode_t; 

AlrmMode_t AlarmModes ={
	
   VL53L0X_GPIOFUNCTIONALITY_THRESHOLD_CROSSED_OUT,// value < thresh_low OR value > thresh_high
	 Thresh_Low<<16,
	 Thresh_High<<16
};
static void exti_init(void)  //中断配置初始化
{
	GPIO_InitTypeDef GPIO_InitStructure;
	EXTI_InitTypeDef EXTI_InitStructure;
 	NVIC_InitTypeDef NVIC_InitStructure;
	
	RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOA,ENABLE);//使能PORTA时钟
	RCC_APB2PeriphClockCmd(RCC_APB2Periph_AFIO,ENABLE);	//使能复用功能时钟
	
	GPIO_InitStructure.GPIO_Pin  = GPIO_Pin_4;
	GPIO_InitStructure.GPIO_Mode = GPIO_Mode_IPU; //设置成上拉输入
 	GPIO_Init(GPIOA, &GPIO_InitStructure);

  GPIO_EXTILineConfig(GPIO_PortSourceGPIOA,GPIO_PinSource4);
	EXTI_InitStructure.EXTI_Line = EXTI_Line4; 
	EXTI_InitStructure.EXTI_Mode = EXTI_Mode_Interrupt;
	EXTI_InitStructure.EXTI_Trigger = EXTI_Trigger_Falling;//下降沿触发
	EXTI_InitStructure.EXTI_LineCmd = ENABLE;
	EXTI_Init(&EXTI_InitStructure);	 	//根据EXTI_InitStruct中指定的参数初始化外设EXTI寄存器
	
	NVIC_InitStructure.NVIC_IRQChannel = EXTI4_IRQn;			    //使能按键WK_UP所在的外部中断通道
	NVIC_InitStructure.NVIC_IRQChannelPreemptionPriority = 0x02;	//抢占优先级2， 
	NVIC_InitStructure.NVIC_IRQChannelSubPriority = 0x03;		    //子优先级3
	NVIC_InitStructure.NVIC_IRQChannelCmd = ENABLE;				    //使能外部中断通道
	NVIC_Init(&NVIC_InitStructure); 
	
}

//警报标志位 alarm_flag 1:有警报  0：无
u8 alarm_flag=0;
void EXTI4_IRQHandler(void)  //外部中断服务函数
{
	alarm_flag=1;//标志
	EXTI_ClearITPendingBit(EXTI_Line4);  //清除LINE4上的中断标志位 
}

extern uint8_t AjustOK;
extern mode_data Mode_data[];


//vl53l0x中断测量模式测试  dev:设备I2C参数结构体
void vl53l0x_interrupt_test(VL53L0X_Dev_t *dev)
{
	u8 mode=0;
	LED=1;
	while(1)
	{
		//	vl53l0x_interrupt_start(dev,mode);
			mode=0;
	}			
  delay_ms(50);	
}
