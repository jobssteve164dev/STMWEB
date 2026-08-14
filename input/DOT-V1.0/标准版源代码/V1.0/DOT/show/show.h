#ifndef __SHOW_H
#define __SHOW_H
#include "sys.h"
extern float Velocity_Left,Velocity_Right;//左轮速度、右轮速度
void oled_show(void);
void lcd_show(void);
void fill_picture(unsigned char fill_Data);    //OLED填充图片函数
#endif
