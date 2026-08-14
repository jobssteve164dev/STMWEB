#include "show.h"
#include "lcd_init.h"
#include "lcd.h"

#define num_color GREEN //RED

float Velocity_Left,Velocity_Right;	//车轮速度(mm/s)
/*函数功能：OLED显示*/
void oled_show(void)
{
		//=============第一行显示小车模式=======================//	
		     if(Way_Angle==1)	OLED_ShowString(0,0,"DMP",12);
		else if(Way_Angle==2)	OLED_ShowString(0,0,"Kalman",12);
		else if(Way_Angle==3)	OLED_ShowString(0,0,"C F",12);
                   
	       if(Flag_follow==1) OLED_ShowString(70,0,"Follow",12);
				 if(Flag_avoid==1) OLED_ShowString(70,0,"Avoid",12);
 		     else               OLED_ShowString(70,0,"Remot_mode",12);
		//=============第二行显示角度=======================//	
		                      OLED_ShowString(00,1,"Angle",12);
		if( Angle_Balance<0)	OLED_ShowString(48,1,"-",12);
		if(Angle_Balance>=0)	OLED_ShowString(48,1,"+",12);
		                      OLED_ShowNum(56,1, myabs((int)Angle_Balance),3,12);
													OLED_ShowString(76,1,".",12);
													OLED_ShowNum(84,1,(int)(myabs(Angle_Balance*10)%10),1,12);			
	  //=============第三行显示角速度与距离===============//	
													OLED_ShowString(0,2,"Gyrox",12);
		if(Gyro_Balance<0)	  OLED_ShowString(42,2,"-",12);
		if(Gyro_Balance>=0)	  OLED_ShowString(42,2,"+",12);
		                      OLED_ShowNum(50,2, myabs((int)Gyro_Balance),4,12);
													
													OLED_ShowNum(82,2,(u16)Distance,5,12);
			                    OLED_ShowString(114,2,"mm",12);

		//=============第四行显示左编码器PWM与读数=======================//		
		                      OLED_ShowString(00,3,"L",12);
		if(Motor_Left<0)		  OLED_ShowString(16,3,"-",12),
													OLED_ShowNum(26,3,myabs((int)Motor_Left),4,12);
		if(Motor_Left>=0)	    OLED_ShowString(16,3,"+",12),
		                      OLED_ShowNum(26,3,myabs((int)Motor_Left),4,12);
													
		if(Velocity_Left<0)	  OLED_ShowString(60,3,"-",12);
		if(Velocity_Left>=0)	OLED_ShowString(60,3,"+",12);
		                      OLED_ShowNum(68,3,myabs((int)Velocity_Left),4,12);
													OLED_ShowString(96,3,"cm/s",12);
	
		//=============第五行显示右编码器PWM与读数=======================//		
		                      OLED_ShowString(00,4,"R",12);
		if(Motor_Right<0)		  OLED_ShowString(16,4,"-",12),
													OLED_ShowNum(26,4,myabs((int)Motor_Right),4,12);
		if(Motor_Right>=0)	  OLED_ShowString(16,4,"+",12),
		                      OLED_ShowNum(26,4,myabs((int)Motor_Right),4,12);
													
		if(Velocity_Right<0)	OLED_ShowString(60,4,"-",12);
		if(Velocity_Right>=0)	OLED_ShowString(60,4,"+",12);
		                      OLED_ShowNum(68,4,myabs((int)Velocity_Right),4,12);
													OLED_ShowString(96,4,"cm/s",12);

		//=============第六行显示电压与电机开关=======================//
		                      OLED_ShowString(0,5,"V",12);
													OLED_ShowString(30,5,".",12);
													OLED_ShowString(54,5,"V",12);
													OLED_ShowNum(19,5,Voltage/1000,2,12);
													OLED_ShowNum(36,5,Voltage%1000,2,12);
		
		if(Flag_Stop)         OLED_ShowString(85,5,"OFF",12);
		if(!Flag_Stop)        OLED_ShowString(85,5,"ON ",12);
		
		//=============第七行显示遥控速度=======================//
		OLED_ShowString(0,6,"V_r:",12);

    if(remot_moto<0)	OLED_ShowString(32,6,"-",12);
		if(remot_moto>=0)	OLED_ShowString(32,6,"+",12);
		                  OLED_ShowNum(38,6,myabs((int)remot_moto),4,12);
			
			OLED_ShowString(80,6,"t_r:",12);
    if(remot_angle<0)	OLED_ShowString(100,6,"-",12);
		if(remot_angle>=0)	OLED_ShowString(100,6,"+",12);
		                  OLED_ShowNum(105,6,myabs((int)remot_angle),4,12);			
											
											
											
}

void lcd_show(void)
{
		//=============第一行显示小车模式与电机开关机=======================//	
		     if(Way_Angle==1)	LCD_ShowString(0,0,"DMP",RED,WHITE,12,0);
		else if(Way_Angle==2)	LCD_ShowString(0,0,"Kalman",RED,WHITE,12,0);
		else if(Way_Angle==3)	LCD_ShowString(0,0,"C F",RED,WHITE,12,0);
                   
	       if(Flag_follow==1) LCD_ShowString(55,0,"Follow",RED,WHITE,12,0);
				 else if(Flag_avoid==1)LCD_ShowString(55,0,"Avoid",RED,WHITE,12,0);
 		     else               LCD_ShowString(55,0,"Normal",RED,WHITE,12,0);
	
	  if(Flag_Stop)         LCD_ShowString(120,0,"OFF",RED,WHITE,12,0);
		if(!Flag_Stop)        LCD_ShowString(120,0,"ON ",RED,WHITE,12,0);
	
		//=============第二行显示角度与角速度=======================//	
													LCD_ShowString(0,12,"Angle:",RED,WHITE,12,0);
		if( Angle_Balance<0)	LCD_ShowString(40,12,"-",num_color,WHITE,12,0);
		if(Angle_Balance>=0)	LCD_ShowString(40,12,"+",num_color,WHITE,12,0);
		                      LCD_ShowIntNum(46,12, myabs((int)Angle_Balance),3,num_color,WHITE,12);
													LCD_ShowString(66,12,".",num_color,WHITE,12,0);
													LCD_ShowIntNum(74,12, (int)(myabs(Angle_Balance*10)%10),1,num_color,WHITE,12);		
	
													LCD_ShowString(90,12,"Gyr:",RED,WHITE,12,0);
		if(Gyro_Balance<0)	  LCD_ShowString(115,12,"-",num_color,WHITE,12,0);
		if(Gyro_Balance>=0)	  LCD_ShowString(115,12,"+",num_color,WHITE,12,0);
		                      LCD_ShowIntNum(125,12, myabs((int)Gyro_Balance),4,num_color,WHITE,12);
	
		//=============第三行显示距离与电压===============//												
													LCD_ShowString(0,24,"Dis:",RED,WHITE,12,0);
													LCD_ShowIntNum(26,24,(u16)Distance/10,3,num_color,WHITE,12);
			                    LCD_ShowString(52,24,"cm",RED,WHITE,12,0);
													
													LCD_ShowString(75,24,"Vol:",RED,WHITE,12,0);
													LCD_ShowString(135,24,"mV",RED,WHITE,12,0);
													LCD_ShowIntNum(102,24,Voltage,4,num_color,WHITE,12);											
													
		//=============第四行显示左编码器PWM与读数=======================//		
													LCD_ShowString(0,36,"L_pwm:",RED,WHITE,12,0);
		if(Motor_Left<0)		  LCD_ShowString(37,36,"-",num_color,WHITE,12,0),
													LCD_ShowIntNum(47,36,myabs((int)Motor_Left),4,num_color,WHITE,12);
		if(Motor_Left>=0)	    LCD_ShowString(37,36,"+",num_color,WHITE,12,0),
		                      LCD_ShowIntNum(47,36,myabs((int)Motor_Left),4,num_color,WHITE,12);
													
		if(Velocity_Left<0)	  LCD_ShowString(80,36,"-",num_color,WHITE,12,0);
		if(Velocity_Left>=0)	LCD_ShowString(80,36,"+",num_color,WHITE,12,0);
		                      LCD_ShowIntNum(87,36,myabs((int)Velocity_Left),3,num_color,WHITE,12);
													LCD_ShowString(111,36,"cm/s",RED,WHITE,12,0);
	
		//=============第五行显示右编码器PWM与读数=======================//		
													LCD_ShowString(0,48,"R_pwm:",RED,WHITE,12,0);
		if(Motor_Right<0)		  LCD_ShowString(37,48,"-",num_color,WHITE,12,0),
													LCD_ShowIntNum(47,48,myabs((int)Motor_Right),4,num_color,WHITE,12);
		if(Motor_Right>=0)	  LCD_ShowString(37,48,"+",num_color,WHITE,12,0),
		                      LCD_ShowIntNum(47,48,myabs((int)Motor_Right),4,num_color,WHITE,12);
													
		if(Velocity_Right<0)	LCD_ShowString(80,48,"-",num_color,WHITE,12,0);
		if(Velocity_Right>=0)	LCD_ShowString(80,48,"+",num_color,WHITE,12,0);
		                      LCD_ShowIntNum(87,48,myabs((int)Velocity_Right),3,num_color,WHITE,12);
													LCD_ShowString(111,48,"cm/s",RED,WHITE,12,0);

		//=============第六行显示速度与电机开关=======================//
		                      
		LCD_ShowString(0,60,"V_r:",RED,WHITE,12,0);
		if(remot_moto<0)	LCD_ShowString(25,60,"-",RED,WHITE,12,0);
		if(remot_moto>=0)	LCD_ShowString(25,60,"+",RED,WHITE,12,0);
		                  LCD_ShowIntNum(35,60,myabs((int)remot_moto),3,num_color,WHITE,12);
			
		LCD_ShowString(80,60,"t_r:",RED,WHITE,12,0);
    if(remot_angle<0)	LCD_ShowString(105,60,"-",RED,WHITE,12,0);
		if(remot_angle>=0)LCD_ShowString(105,60,"+",RED,WHITE,12,0);
		                  LCD_ShowIntNum(115,60,myabs((int)remot_angle),3,num_color,WHITE,12);
		
		
										
											
}

void fill_picture(unsigned char fill_Data)    //OLED填充图片函数
{
	unsigned char m,n;
	for(m=0;m<8;m++)
	{
		OLED_WR_Byte(0xb0+m,0);	//从第0页到第7页
		OLED_WR_Byte(0x00,0);		//low column start address
		OLED_WR_Byte(0x10,0);		//high column start address
		for(n=0;n<128;n++)OLED_WR_Byte(fill_Data,1);	
	}
}



