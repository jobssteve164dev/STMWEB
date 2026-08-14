#include "DataScope_DP.h"
#include "usart.h"	 
#include "stdio.h"
#include "sys.h"	
#include <stdlib.h>
#include <string.h>

u8 RX_buf[20]={0};
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











