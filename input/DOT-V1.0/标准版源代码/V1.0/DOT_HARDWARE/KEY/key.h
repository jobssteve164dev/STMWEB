#ifndef __KEY_H
#define __KEY_H	 
#include "sys.h"
#define KEY PBin(8)
void KEY_Init(void);          //按键初始化
u8 key_read(void); /*按键扫描入口参数：双击等待时间返回  值：按键状态 0：无动作 1：单击 2：双击 */
#endif  
