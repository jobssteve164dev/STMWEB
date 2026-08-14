#ifndef __MOTOR_H
#define __MOTOR_H
#include <sys.h>	 
#define PWMB   TIM3->CCR4  //PA11
#define ENB   PBout(4)
#define DIRB   PBout(5)
#define ENA   PBout(9)
#define DIRA   PCout(15)
#define PWMA   TIM3->CCR1  //PA6

void MiniBalance_PWM_Init(u16 arr,u16 psc);
void MiniBalance_Motor_Init(void);
#endif
