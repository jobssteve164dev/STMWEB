#include "motor.h"

void MiniBalance_Motor_Init(void)
{
  GPIO_InitTypeDef GPIO_InitStructure;
  RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOB|RCC_APB2Periph_GPIOC, ENABLE); //使能PB端口时钟
	
	
  GPIO_InitStructure.GPIO_Pin = GPIO_Pin_4|GPIO_Pin_5|GPIO_Pin_9;	//端口配置
  GPIO_InitStructure.GPIO_Mode = GPIO_Mode_Out_PP;      //推挽输出
	GPIO_InitStructure.GPIO_Speed = GPIO_Speed_50MHz;     //50M
  GPIO_Init(GPIOB, &GPIO_InitStructure);					      //根据设定参数初始化GPIOB 
	
	GPIO_InitStructure.GPIO_Pin = GPIO_Pin_15;	//端口配置
  GPIO_InitStructure.GPIO_Mode = GPIO_Mode_Out_PP;      //推挽输出
	GPIO_InitStructure.GPIO_Speed = GPIO_Speed_50MHz;     //50M
  GPIO_Init(GPIOC, &GPIO_InitStructure);					      //根据设定参数初始化GPIOB 
	
	ENA=1;
	ENB=1;
}

void MiniBalance_PWM_Init(u16 arr,u16 psc)
{		 		
	
	GPIO_InitTypeDef GPIO_InitStruct;         
	TIM_TimeBaseInitTypeDef TIM_TimeBaseInitStruct;
	TIM_OCInitTypeDef TIM_OCInitStruct;   //结构体定义
	
	
	RCC_APB2PeriphClockCmd(RCC_APB2Periph_GPIOA|RCC_APB2Periph_GPIOB|RCC_APB2Periph_AFIO,ENABLE);        //开启时钟  
	RCC_APB1PeriphClockCmd(RCC_APB1Periph_TIM3, ENABLE);
	
	GPIO_InitStruct.GPIO_Mode=GPIO_Mode_AF_PP;      //初始化GPIOB
	GPIO_InitStruct.GPIO_Pin=GPIO_Pin_1;
	GPIO_InitStruct.GPIO_Speed=GPIO_Speed_50MHz;
	GPIO_Init(GPIOB,&GPIO_InitStruct);
	
	GPIO_InitStruct.GPIO_Mode=GPIO_Mode_AF_PP;      //初始化GPIOA
	GPIO_InitStruct.GPIO_Pin=GPIO_Pin_6;
	GPIO_InitStruct.GPIO_Speed=GPIO_Speed_50MHz;
	GPIO_Init(GPIOA,&GPIO_InitStruct);
 
	TIM_TimeBaseStructInit(&TIM_TimeBaseInitStruct);     //初始化定时器
	TIM_TimeBaseInitStruct.TIM_ClockDivision=TIM_CKD_DIV1;       
	TIM_TimeBaseInitStruct.TIM_CounterMode=TIM_CounterMode_Up;     
	TIM_TimeBaseInitStruct.TIM_Period=arr;         
	TIM_TimeBaseInitStruct.TIM_Prescaler=psc;      
	TIM_TimeBaseInitStruct.TIM_ClockDivision=0;	
	TIM_TimeBaseInit(TIM3,&TIM_TimeBaseInitStruct);
 
	TIM_OCInitStruct.TIM_OCMode=TIM_OCMode_PWM2;          //初始化输出比较
	TIM_OCInitStruct.TIM_OCPolarity=TIM_OCPolarity_High;
	TIM_OCInitStruct.TIM_OutputState=TIM_OutputState_Enable;
	TIM_OCInitStruct.TIM_Pulse=0;
	
	TIM_OC1Init(TIM3,&TIM_OCInitStruct );          //初始化4通道1：A6 2:A7 3:B0 4:B1
	//TIM_OC2Init(TIM3,&TIM_OCInitStruct );
	//TIM_OC3Init(TIM3,&TIM_OCInitStruct );          
	TIM_OC4Init(TIM3, &TIM_OCInitStruct);
	
	TIM_OC1PreloadConfig(TIM3,TIM_OCPreload_Enable);
	//TIM_OC2PreloadConfig(TIM3,TIM_OCPreload_Enable);
	//TIM_OC3PreloadConfig(TIM3,TIM_OCPreload_Enable);      //OC1-OC4装载寄存器使能
	TIM_OC4PreloadConfig(TIM3,TIM_OCPreload_Enable);		
	
	TIM_ARRPreloadConfig(TIM3,ENABLE);      //TIM3在APR上预装载寄存器使能
	
	TIM_Cmd(TIM3,ENABLE);    //开定时器
	PWMA=0;
	PWMB=0;
} 



