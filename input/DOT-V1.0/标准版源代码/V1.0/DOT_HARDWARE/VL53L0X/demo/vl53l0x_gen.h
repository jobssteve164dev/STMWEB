#ifndef __VL53L0X_GEN_H
#define __VL53L0X_GEN_H

#include "vl53l0x.h" 

extern VL53L0X_RangingMeasurementData_t vl53l0x_data;

VL53L0X_Error vl53l0x_set_mode(VL53L0X_Dev_t *dev,u8 mode);
char vl53l0x_general_start(VL53L0X_Dev_t *dev,u8 mode);

void vl53l0x_read(VL53L0X_Dev_t *dev);

#endif


