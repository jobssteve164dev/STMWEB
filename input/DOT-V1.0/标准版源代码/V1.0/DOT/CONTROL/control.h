#ifndef __CONTROL_H
#define __CONTROL_H
#include "sys.h"

#define PI 3.14159265							//PI圆周率
#define Control_Frequency  100.0	//编码器读取频率
#define Diameter_67  6.4 				//轮子直径6.4cm 
#define EncoderMultiples   4.0 		//编码器倍频数
#define Encoder_precision  100.0 	//编码器精度 13线
#define Reduction_Ratio  1			//减速比30
#define Perimeter  20.1 			//周长，单位cm

#define Middle_angle -2.5
#define DIFFERENCE 100
int EXTI15_10_IRQHandler(void);
int Balance(float angle,float gyro);
int Velocity(int encoder_left,int encoder_right);
int Turn(float gyro);
void Set_Pwm(int motor_left,int motor_right);
void Key(void);
void Limit_Pwm(void);
int PWM_Limit(int IN,int max,int min);
u8 Turn_Off(float angle, int voltage);
void Get_Angle(u8 way);
int myabs(int a);
int Pick_Up(float Acceleration,float Angle,int encoder_left,int encoder_right);
int Put_Down(float Angle,int encoder_left,int encoder_right);
void Get_Encoder(int encoder_left,int encoder_right);
void Choose(int encoder_left,int encoder_right);

#endif
