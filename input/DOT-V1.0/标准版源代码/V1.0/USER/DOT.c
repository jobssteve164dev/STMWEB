/***********************************************
公司：郑州纤毫电子科技有限公司
品牌：高校电子杂耍社
官网：www.noobfun.com
淘宝店铺：高校电子杂耍社
版本：1.0
修改时间：2022-11-9
All rights reserved
***********************************************/
#include "stm32f10x.h"
#include "sys.h"
#include "lcd_init.h"
#include "lcd.h"
#include "usart2.h"
#include "vl53l0x.h"
u8 Way_Angle=2;     //获取角度的算法，1：四元数  2：卡尔曼  3：互补滤波 
u8 Flag_front;			//蓝牙遥控前进标志位
u8 Flag_back;				//蓝牙遥控后退标志位
u8 Flag_Left;				//蓝牙遥控左转
u8 Flag_Right;			//蓝牙遥控右转
u8 Flag_Stop=1;			//电机停止标志位，默认停止
u8 Flag_Show=0;     //显示标志位  默认显示打开
int Motor_Left,Motor_Right;                 //电机PWM变量 应是Motor的 向Moto致敬	
int Temperature;                            //温度变量
int Voltage;                                //电池电压采样相关的变量
float Angle_Balance=0,Gyro_Balance=0,Gyro_Turn=0; //平衡倾角 平衡陀螺仪 转向陀螺仪
int Distance;                               //超声波测距
u8 delay_50,delay_flag,PID_Send; 						//延时和调参相关变量
u8 Flag_follow=0,Flag_avoid=0;											//激光测距跟随、壁障标志位
float Acceleration_Z;                       //Z轴加速度计

float Balance_Kp=120,Balance_Kd=0.3;//PID参数
float Velocity_Kp=120,Velocity_Ki=0.6;//PID参数
float Turn_Kp=30,Turn_Kd=0.3;//PID参数

char vl5310_flag=0;
int num=0;

int main(void)
{ 
  MY_NVIC_PriorityGroupConfig(2);	//设置中断分组
	delay_init();	    	            //延时函数初始化	
	JTAG_Set(JTAG_SWD_DISABLE);     //关闭JTAG接口
	JTAG_Set(SWD_ENABLE);           //打开SWD接口 可以利用主板的SWD接口调试
	KEY_Init();                     //按键初始化
	MiniBalance_Motor_Init();
	MiniBalance_PWM_Init(7199,0);   //定时器1，初始化PWM 10KHZ与电机硬件接口，用于驱动电机
	uart_init(115200);	            //串口1初始化,正常打印
	uart2_init(72,115200*2);        //串口2初始化，用于循迹模块
	uart3_init(115200);             //串口3初始化，用于蓝牙模块
	Encoder_Init_TIM2();            //编码器接口
	Encoder_Init_TIM4();            //初始化编码器4
	
	IIC_Init();                     //IIC初始化
	OLED_Init();                    //OLED初始化
  fill_picture(0x00);	            //OLED清屏	
	
	LCD_Init();                         //LCD初始化
	LCD_Fill(0,0,LCD_W,LCD_H,WHITE);    //LCD刷屏为白色
	
	
	LCD_ShowString(20,36,"mpu6050 init",RED,WHITE,12,0);
	delay_ms(1000);
	MPU6050_initialize();           //MPU6050初始化	
	DMP_Init();                     //初始化DMP 
	LCD_ShowString(20,36,"mpu6050 success!",RED,WHITE,12,0);
	delay_ms(1000);
	
	
	LCD_Fill(0,0,LCD_W,LCD_H,WHITE);    //LCD刷屏为白色
	LCD_ShowString(20,36,"VL5310 init...",RED,WHITE,12,0);
	delay_ms(1000);
	LCD_Fill(0,0,LCD_W,LCD_H,WHITE);    //LCD刷屏为白色
	#ifdef VL5310
	vl5310_flag=1;
	vl53l0x_init1(&vl53l0x_dev1);
	if(vl53l0x_general_start(&vl53l0x_dev1,0)==0)	
	{
		vl5310_flag=1;
		LCD_ShowString(20,36,"VL5310 success!!!",RED,WHITE,12,0);
	}
	else	
	{
		LCD_ShowString(20,36,"NO VL5310!!!",RED,WHITE,12,0);
		vl5310_flag=0;
	}
	delay_ms(1000);
	LCD_Fill(0,0,LCD_W,LCD_H,WHITE);    //LCD刷屏为白色
	#endif
	
	
	Adc_Init();                     //adc初始化
	Timer1_Init(99,7199);           //定时中断初始化 
	while(1)
	{
			// oled_show();          			//显示屏打开
		lcd_show();
		#ifdef VL5310
	  if(vl5310_flag)vl53l0x_read(&vl53l0x_dev1);                //读取传感器1距离
	  #endif
	}
}

