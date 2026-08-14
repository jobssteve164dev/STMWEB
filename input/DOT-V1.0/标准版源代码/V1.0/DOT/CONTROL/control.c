#include "control.h"	
#include "usart3.h"	

char t=0,n=0;

char ANGLE[5];
char GRO[5];
char SPEED[4];
char data_oth[5];
char vol_low=0;
char vol_low_time=0;

/*函数功能：所有的控制代码都在这里面，10ms定时器中断， 严格保证采样和数据处理的时间同步*/
int TIM1_UP_IRQHandler(void)          //所有的控制代码都在这里面 TIM1控制的10ms定时中断  
{    
	static int Voltage_Temp,Voltage_Count,Voltage_All;		//电压测量相关变量
	int Encoder_Left,Encoder_Right;             					//左右编码器的脉冲计数
	int Balance_Pwm,Velocity_Pwm,Turn_Pwm;		  					//平衡环PWM变量，速度环PWM变量，转向环PWM变
	if(TIM1->SR&0X0001)
	{   
		  TIM1->SR&=~(1<<0);      														//清除定时器1中断标志位
			Get_Angle(Way_Angle);                     					//更新姿态
			Encoder_Left=Read_Encoder(2);            						//读取左轮编码器的值，前进为正，后退为负
			Encoder_Right=-Read_Encoder(4);           					//读取右轮编码器的值，前进为正，后退为负
		  if(Encoder_Left==0)ENA=0;														//如果车轮速度为0了，就关闭电机使能，防止电机进入休眠状态
		  if(Encoder_Right==0)ENB=0;											
			Get_Encoder(Encoder_Left,Encoder_Right);						//编码器读数转速度（mm/s）
			Voltage_Temp=Get_battery_volt();		    						//读取电池电压		
			Voltage_Count++;                       							//平均值计数
			Voltage_All+=Voltage_Temp;              						//100次采样累积
			if(Voltage_Count==100) 
			{
				Voltage=Voltage_All/100,Voltage_All=0,Voltage_Count=0;//求平均值
				if(Voltage<3000)vol_low_time++;												//电池电压低于3V
				else vol_low_time=0;
				if(vol_low_time==10)vol_low=1;
			}																							
			Key();                                    					//扫描按键状态 单击双击可以改变小车运行状态
			Balance_Pwm=Balance(Angle_Balance,Gyro_Balance);    //平衡PID控制 Gyro_Balance平衡角速度极性：前倾为正，后倾为负
			Velocity_Pwm=Velocity(Encoder_Left,Encoder_Right);  //速度环PID控制,速度反馈是正反馈，小车要慢下来就需要再跑快一点
			Turn_Pwm=Turn(Gyro_Turn);														//转向环PID控制     
			
			Motor_Left=Balance_Pwm+Velocity_Pwm+Turn_Pwm;       //计算左轮电机最终PWM
			Motor_Right=Balance_Pwm+Velocity_Pwm-Turn_Pwm;      //计算右轮电机最终PWM
																													//PWM值正数使小车前进，负数使小车后退
			Motor_Left=PWM_Limit(Motor_Left,6000,-6000);
			Motor_Right=PWM_Limit(Motor_Right,6000,-6000);			//PWM限幅
			
			
			if(Pick_Up(Acceleration_Z,Angle_Balance,Encoder_Left,Encoder_Right))Flag_Stop=1;	//检查是否小车被拿起,如果被拿起就关闭电机
			if(Put_Down(Angle_Balance,Encoder_Left,Encoder_Right))Flag_Stop=0;								//检查是否小车被放下,如果被放下就启动电机
			if(Angle_Balance<-80||Angle_Balance>80||1==Flag_Stop||vol_low==1)Flag_Stop=1;
			#ifdef VL5310
			if(vl5310_flag)Choose(Encoder_Left,Encoder_Right);									//转动右轮选择小车模式
			#endif
			
			if(Flag_Stop==0)Set_Pwm(Motor_Left,Motor_Right);  
			else Set_Pwm(0,0);
			
			if(t==0) //每隔20ms发出一次舵机脉冲
			{
				Usart3_SendString("dy", 3);
			  sprintf(ANGLE,"%05d",(int)((Angle_Balance+90)*100));			Usart3_SendString((unsigned char *)ANGLE, 5);
			  sprintf(GRO,"%05d",(int)Gyro_Balance);							Usart3_SendString((unsigned char *)GRO, 5);
			  sprintf(SPEED,"%04d",Encoder_Left+Encoder_Right);											Usart3_SendString((unsigned char *)SPEED, 4);
			}
			else if(t==2)    //每隔20ms上传一次姿态信息
			{
				//上传通信协议：dx+5位x轴角度+5位x轴角速度+4位x轴轮速+
				//								 5位y轴角度+5位y轴角速度+4位y轴轮速+
				//								 4位bkp_x+4位bki_x+4位bkd_x+
				//								 4位skp_x+4位ski_x+4位skd_x+
				//								 4位bkp_y+4位bki_y+4位bkd_y+
				//								 4位skp_y+4位ski_y+4位skd_y+
				//								 4位电池电压												中间缺失项用'N'补齐						
				if(n==0){Usart3_SendString("bpy", 3);memset(data_oth, 0, 5);	sprintf(data_oth,"%f",Balance_Kp);	Usart3_SendString((unsigned char *)data_oth, 5);}
				else if(n==1){Usart3_SendString("biy", 3);memset(data_oth, 0, 5);	sprintf(data_oth,"%f",0.0);	Usart3_SendString((unsigned char *)data_oth, 5);}
				else if(n==2){Usart3_SendString("bdy", 3);memset(data_oth, 0, 5);	sprintf(data_oth,"%f",Balance_Kd);	Usart3_SendString((unsigned char *)data_oth, 5);}
				else if(n==3){Usart3_SendString("spy", 3);memset(data_oth, 0, 5);	sprintf(data_oth,"%f",Velocity_Kp);	Usart3_SendString((unsigned char *)data_oth, 5);}
				else if(n==4){Usart3_SendString("siy", 3);memset(data_oth, 0, 5);sprintf(data_oth,"%f",Velocity_Ki);	Usart3_SendString((unsigned char *)data_oth, 5);}
				else if(n==5){Usart3_SendString("sdy", 3);memset(data_oth, 0, 5);sprintf(data_oth,"%f",0.0);	Usart3_SendString((unsigned char *)data_oth, 5);}
				else if(n==6){Usart3_SendString("bat", 3);memset(data_oth, 0, 5);sprintf(data_oth,"%f",((float)Voltage)/1000.0);	Usart3_SendString((unsigned char *)data_oth, 5);}
				else if(n==7){Usart3_SendString("pwm", 3);memset(data_oth, 0, 5);sprintf(data_oth,"%f",(float)(Motor_Left+Motor_Right)/2);	Usart3_SendString((unsigned char *)data_oth, 5);}
				n++;
				if(n>20)n=0;
				
			}
			t++;
			if(t==4)t=0;
			communication();        //与上位机交互  
		}
	 return 0;	  
} 

int Balance(float Angle,float Gyro)
{  
   float Angle_bias,Gyro_bias;
	 int balance;
	 Angle_bias=Middle_angle-Angle;                       				//求出平衡的角度中值 和机械相关
	 Gyro_bias=-Gyro; 
	 balance=-Balance_Kp*Angle_bias+Gyro_bias*Balance_Kd; //计算平衡控制的电机PWM  PD控制   kp是P系数 kd是D系数 
	 return balance;
}

/*速度控制PWM	，入口参数：encoder_left：左轮编码器读数；encoder_right：右轮编码器读数，返回  值：速度控制PWM*/
int Velocity(int encoder_left,int encoder_right)
{  
    static float velocity,Encoder_Least,Encoder_bias,Movement;
	  static float Encoder_Integral,Target_Velocity;
	  //================遥控前进后退部分====================// 
		if(Flag_follow==1)			//启动了激光测距（跟随避障）功能
		{
			if(Distance<150||Distance>300) Movement=0;		              						//前方无障碍物，正常遥控，前进电机赋值
			else Movement=(150-Distance)/5;		          //有障碍物但比较近，避障后退		
      if(Movement>17)Movement=17;
			if(Movement<-17)Movement=-17;
		}
		else if(Flag_avoid==1)
		{
			if(Distance>200) Movement=0;		              						//前方无障碍物，正常遥控，前进电机赋值
			else Movement=(200-Distance);		          //有障碍物但比较近，避障后退		
      if(Movement>15)Movement=15;
			if(Movement<-15)Movement=-15;
		}
		else 		Movement=-remot_moto/3;  //否则正常遥控功能
		
   //================速度PI控制器=====================//	
		Encoder_Least =Movement-(encoder_left+encoder_right);                    //获取最新速度偏差=目标速度（此处为零）-测量速度（左右编码器之和） 
		Encoder_bias *= 0.86;		                                          //一阶低通滤波器       
		Encoder_bias += Encoder_Least*0.14;	                              //一阶低通滤波器，减缓速度变化 
		Encoder_Integral +=Encoder_bias;                                  //积分出位移 积分时间：10ms
		Encoder_Integral=Encoder_Integral;                       //接收遥控器数据，控制前进后退
		if(Encoder_Integral>1000)  	Encoder_Integral=1000;             //积分限幅
		if(Encoder_Integral<-1000)	  Encoder_Integral=-1000;            //积分限幅	
		velocity=-Encoder_bias*Velocity_Kp-Encoder_Integral*Velocity_Ki;     //速度控制	
		if(Flag_Stop==1) Encoder_Integral=0;//电机关闭后清除积分
	  return velocity;
}
/*Input   : Z-axis angular velocity
Output  : Turn control PWM
函数功能：转向控制 
入口参数：Z轴陀螺仪
返回  值：转向控制PWM*/
int Turn(float gyro)
{
	 static float Turn_Target,turn,Turn_Amplitude=54;
	 float Kp=Turn_Kp,Kd;			
	//===================遥控左右旋转部分=================//
	
	 Turn_Target=-remot_angle;
	 if(myabs(Turn_Target)!=0)  Kd=Turn_Kd;        
	 else Kd=0;                               //转向的时候取消陀螺仪的纠正 有点模糊PID的思想
  //===================转向PD控制器=================//
	 turn=-Turn_Target*Kp-gyro*Kd;//结合Z轴陀螺仪进行PD控制
	 return turn;								 				 //转向环PWM右转为正，左转为负
}

void Set_Pwm(int motor_left,int motor_right)
{
	
	if(myabs(motor_left)>100)ENB=1;
	if(myabs(motor_right)>100)ENA=1;
	
  if(motor_left>0)	    DIRB=1;   //前进 
	else           			  DIRB=0;   //后退
	PWMB=myabs(motor_left);	
  if(motor_right>0)			DIRA=0;	  //前进
	else 	        			  DIRA=1;   //后退
	PWMA=myabs(motor_right);
}
/*IN：Input  max：Maximum value  min：Minimum value
Output  : Output
函数功能：限制PWM赋值 
入口参数：IN：输入参数  max：限幅最大值  min：限幅最小值
返回  值：限幅后的值*/
int PWM_Limit(int IN,int max,int min)
{
	int OUT = IN;
	if(OUT>max) OUT = max;
	if(OUT<min) OUT = min;
	return OUT;
}

void Key(void)	/*按键修改小车运行状态 */
{
	u8 tmp;
	tmp=key_read(); 
	if(tmp==1)
	{ 
		Flag_Stop=!Flag_Stop;
		Set_Pwm(0,0);
		delay_ms(500);
	}	
}

	
/**************************************************************************
Function: Get angle
Input   : way：The algorithm of getting angle 1：DMP  2：kalman  3：Complementary filtering
Output  : none
函数功能：获取角度	
入口参数：way：获取角度的算法 1：DMP  2：卡尔曼 3：互补滤波
返回  值：无
**************************************************************************/	
void Get_Angle(u8 way)
{ 
	float Accel_Y,Accel_Z,Accel_X,Accel_Angle_x,Accel_Angle_y,Gyro_X,Gyro_Z,Gyro_Y;
	Temperature=Read_Temperature();      //读取MPU6050内置温度传感器数据，近似表示主板温度。
	if(way==1)                           //DMP的读取在数据采集中断读取，严格遵循时序要求
	{	
		Read_DMP();                      	 //读取加速度、角速度、倾角
		Angle_Balance=Pitch;             	 //更新平衡倾角,前倾为正，后倾为负
		Gyro_Balance=gyro[0];              //更新平衡角速度,前倾为正，后倾为负
		Gyro_Turn=gyro[2];                 //更新转向角速度
		Acceleration_Z=accel[2];           //更新Z轴加速度计
	}			
	else
	{
		Gyro_X=(I2C_ReadOneByte(devAddr,MPU6050_RA_GYRO_XOUT_H)<<8)+I2C_ReadOneByte(devAddr,MPU6050_RA_GYRO_XOUT_L);    //读取X轴陀螺仪
		Gyro_Y=(I2C_ReadOneByte(devAddr,MPU6050_RA_GYRO_YOUT_H)<<8)+I2C_ReadOneByte(devAddr,MPU6050_RA_GYRO_YOUT_L);    //读取Y轴陀螺仪
		Gyro_Z=(I2C_ReadOneByte(devAddr,MPU6050_RA_GYRO_ZOUT_H)<<8)+I2C_ReadOneByte(devAddr,MPU6050_RA_GYRO_ZOUT_L);    //读取Z轴陀螺仪
		Accel_X=(I2C_ReadOneByte(devAddr,MPU6050_RA_ACCEL_XOUT_H)<<8)+I2C_ReadOneByte(devAddr,MPU6050_RA_ACCEL_XOUT_L); //读取X轴加速度计
		Accel_Y=(I2C_ReadOneByte(devAddr,MPU6050_RA_ACCEL_YOUT_H)<<8)+I2C_ReadOneByte(devAddr,MPU6050_RA_ACCEL_YOUT_L); //读取X轴加速度计
		Accel_Z=(I2C_ReadOneByte(devAddr,MPU6050_RA_ACCEL_ZOUT_H)<<8)+I2C_ReadOneByte(devAddr,MPU6050_RA_ACCEL_ZOUT_L); //读取Z轴加速度计
		if(Gyro_X>32768)  Gyro_X-=65536;                 //数据类型转换  也可通过short强制类型转换
		if(Gyro_Y>32768)  Gyro_Y-=65536;                 //数据类型转换  也可通过short强制类型转换
		if(Gyro_Z>32768)  Gyro_Z-=65536;                 //数据类型转换
		if(Accel_X>32768) Accel_X-=65536;                //数据类型转换
		if(Accel_Y>32768) Accel_Y-=65536;                //数据类型转换
		if(Accel_Z>32768) Accel_Z-=65536;                //数据类型转换
		Gyro_Balance=-Gyro_Y;                            //更新平衡角速度
		Accel_Angle_x=atan2(Accel_Y,Accel_Z)*180/PI;     //计算倾角，转换单位为度	
		Accel_Angle_y=atan2(Accel_X,Accel_Z)*180/PI;     //计算倾角，转换单位为度
		Gyro_X=Gyro_X/16.4;                              //陀螺仪量程转换，量程±2000°/s对应灵敏度16.4，可查手册
		Gyro_Y=Gyro_Y/16.4;                              //陀螺仪量程转换	
		if(Way_Angle==2)		  	
		{
//			 Pitch = -Kalman_Filter_x(Accel_Angle_x,Gyro_X);//卡尔曼滤波
//			 Roll = -Kalman_Filter_y(Accel_Angle_y,Gyro_Y);
			 Roll = -Kalman_Filter_x(Accel_Angle_x,Gyro_X);//卡尔曼滤波
			 Pitch = -Kalman_Filter_y(Accel_Angle_y,-Gyro_Y);
		}
		else if(Way_Angle==3) 
		{  
			 Pitch = -Complementary_Filter_x(Accel_Angle_x,Gyro_X);//互补滤波
			 Roll = -Complementary_Filter_y(Accel_Angle_y,Gyro_Y);
		}
		Angle_Balance=Pitch;                              //更新平衡倾角
		Gyro_Turn=Gyro_Z;                                 //更新转向角速度
		Acceleration_Z=Accel_Z;                           //更新Z轴加速度计	
	}
}
int myabs(int a)
{ 		   
	int temp;
	if(a<0)  temp=-a;  
	else temp=a;
	return temp;
}
/*检测小车是否被拿起,入口参数：Acceleration：z轴加速度；Angle：平衡的角度；encoder_left：左编码器计数；encoder_right：右编码器计数
返回  值：1:小车被拿起  0：小车未被拿起*/
int Pick_Up(float Acceleration,float Angle,int encoder_left,int encoder_right)
{ 		   
	 static u16 flag,count0,count1,count2;
	 if(flag==0)                                                      //第一步
	 {
			if(myabs(encoder_left)+myabs(encoder_right)<20)count0++;               //条件1，小车接近静止
			else count0=0;	
			if(count0>10)		flag=1,count0=0; 				
	 } 
	 if(flag==1)                                                      //进入第二步
	 {
			if(++count1>200)       count1=0,flag=0;                       //超时不再等待2000ms，返回第一步
			if(Acceleration>25000&&(Angle>(-20+Middle_angle))&&(Angle<(20+Middle_angle)))   //条件2，小车是在0度附近被拿起
			flag=2; 
	 } 
	 if(flag==2)                                                       //第三步
	 {
		  if(++count2>100)       count2=0,flag=0;                        //超时不再等待1000ms
	    if(myabs(encoder_left)+myabs(encoder_right)>150)                       //条件3，小车的轮胎因为正反馈达到最大的转速   
      {
				flag=0;                                                                                     
				return 1;                                                    //检测到小车被拿起
			}
	 }
	return 0;
}
int Put_Down(float Angle,int encoder_left,int encoder_right)/*检测小车是否被放下    返回  值：1：小车放下   0：小车未放下*/
{ 		   
	 static u16 flag,count;	 
	 if(Flag_Stop==0)return 0;                    //如果停止标志位本来就没有置位，那直接返回0   
				                 
	 if(flag==0)                                               
	 {
			if(Angle>(-10+Middle_angle)&&Angle<(10+Middle_angle)&&encoder_left==0&&encoder_right==0) //条件1，小车是在0度附近的
			flag=1; 
	 } 
	 if(flag==1)      //已经满足了条件1                                         
	 {
		  if(++count>50)                     //超时不再等待 500ms
		  {
				count=0;flag=0;
		  }
	    if(myabs(encoder_left)>2&&myabs(encoder_right)>2&&myabs(encoder_left)<70&&myabs(encoder_right)<70) //条件2，小车的轮胎在未上电的时候被人为转动  
      {
				flag=0;
				return 1;                         //检测到小车被放下
			}
	 }
	return 0;
}
void Get_Encoder(int encoder_left,int encoder_right)/*编码器读数转换为速度（cm/s）*/
{ 	
	float Rotation_Speed_L,Rotation_Speed_R;						//电机转速  转速=编码器读数（10ms每次）*读取频率/倍频数/减速比/编码器精度
	Rotation_Speed_L = encoder_left*Control_Frequency/EncoderMultiples/Reduction_Ratio/Encoder_precision;
	Velocity_Left = Rotation_Speed_L*PI*Diameter_67;		//求出编码器速度=转速*周长
	Rotation_Speed_R = encoder_right*Control_Frequency/EncoderMultiples/Reduction_Ratio/Encoder_precision;
	Velocity_Right = Rotation_Speed_R*PI*Diameter_67;		//求出编码器速度=转速*周长
}
/*选择小车运行模式 encoder_left：左编码器读数  encoder_right：右编码器读数*/
void Choose(int encoder_left,int encoder_right)
{
	static int count;
	if(Flag_Stop==0)count = 0;
	if((Flag_Stop==1)&&(encoder_left==0))	//此时停止且左轮不动
	{
		count += myabs(encoder_right);
		if(count>0&&count<100)Flag_follow=0,Flag_avoid = 0;	  //普通遥控模式		
		if(count>=100&&count<200)Flag_follow=0,Flag_avoid = 1;	  //普通遥控模式		
		if(count>=200&&count<300)Flag_follow=1,Flag_avoid = 0;	//避障跟随模式 
		if(count>=300)	count = 0;
	}
}

