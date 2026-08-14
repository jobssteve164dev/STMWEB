THRESHOLD =(13, 51, -11, 42, -81, -18) # Grayscale threshold for dark things...
import sensor, image, time, pyb
from pyb import LED
from pid import PID
from pyb import UART
rho_pid = PID(p=0.8, i=0)      #距离
#rho_pid = PID(p=0, i=0)      #距离
theta_pid = PID(p=0.1, i=0)    #角度
#theta_pid = PID(p=0, i=0)    #角度

LED(1).on()
LED(2).on()
LED(3).on()
led = pyb.LED(4)
led.on()

sensor.reset()
sensor.set_vflip(True)
sensor.set_hmirror(True)
sensor.set_pixformat(sensor.RGB565)
sensor.set_framesize(sensor.QQQVGA) # 80x60 (4,800 pixels) - O(N^2) max = 2,3040,000.
#sensor.set_windowing([0,20,80,40])
sensor.skip_frames(time = 2000)     # WARNING: If you use QQVGA it may take seconds
clock = time.clock()                # to process a frame sometimes.
uart = UART(3, 115200)              #初始化串口3
arr=[0x30,0x30,0x30,0x30,0x0d,0x0a] #要发送的数组

while(True):
    clock.tick()
    img = sensor.snapshot().binary([THRESHOLD])                  #得到二值化图像
    line = img.get_regression([(100,100)], robust = True)        #从图象中得到线
    if (line):                                                   #如果含有线
        rho_err = abs(line.rho())-img.width()/2                  #求出距离偏差

        if line.theta()>90:
            theta_err = line.theta()-180
        else:
            theta_err = line.theta()                             #求出角度偏差

        img.draw_line(line.line(), color = 127)                  #在图像中画出直线
        print(rho_err,line.magnitude(),rho_err)                  #打印偏差信息

        if line.magnitude()>7:                                   #如果线的长度大于8
            #if -40<b_err<40 and -30<t_err<30:
            rho_output = rho_pid.get_pid(rho_err,1)
            theta_output = theta_pid.get_pid(theta_err,1)
            output = rho_output+theta_output
            if output>99:
                output=99
            if output<-99:
                output=-99
            if abs(output)>10:
                arr[3]='1'        #前进级别
            elif abs(output)>7:
                arr[3]='2'        #前进级别
            elif abs(output)>5:
                arr[3]='3'        #前进级别
            elif abs(output)>3:
                arr[3]='3'        #前进级别
            elif abs(output)>1:
                arr[3]='4'        #前进级别
            else:
                arr[3]='5'        #前进级别
            output=output+100
            arr[0]=int(output/100)        #转弯百位
            arr[1]=int(output%100/10)     #转弯十位
            arr[2]=int(output%10)         #转弯个位
            uart.write(str(arr[0]))
            uart.write(str(arr[1]))
            uart.write(str(arr[2]))
            uart.write(str(arr[3]))
            uart.write('\r')
            uart.write('\n')
        else:                                                    #否则停止前进
            uart.write('1')
            uart.write('0')
            uart.write('0')
            uart.write('0')
            uart.write('\r')
            uart.write('\n')
    else:                                                       #如果没有找到线就停止前进
            uart.write('1')
            uart.write('0')
            uart.write('0')
            uart.write('0')
            uart.write('\r')
            uart.write('\n')

            pass
    #print(clock.fps())
