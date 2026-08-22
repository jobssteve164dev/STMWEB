cmake_minimum_required(VERSION 3.22)

set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)

find_program(ARM_GCC arm-none-eabi-gcc REQUIRED)
find_program(ARM_OBJCOPY arm-none-eabi-objcopy REQUIRED)
find_program(ARM_SIZE arm-none-eabi-size REQUIRED)
find_program(NODE_EXECUTABLE node REQUIRED)
set(CMAKE_C_COMPILER "${ARM_GCC}")
set(CMAKE_ASM_COMPILER "${ARM_GCC}")

project(dot_v1_gcc C ASM)

set(STMWEB_TARGET "${STMWEB_TARGET}" CACHE STRING "STM32 target")
file(READ "${CMAKE_CURRENT_LIST_DIR}/adapter.json" STMWEB_ADAPTER_JSON)
string(JSON STMWEB_TARGET_COUNT LENGTH "${STMWEB_ADAPTER_JSON}" targets)
set(STMWEB_TARGET_FOUND OFF)
math(EXPR STMWEB_TARGET_LAST "${STMWEB_TARGET_COUNT} - 1")
foreach(STMWEB_TARGET_INDEX RANGE ${STMWEB_TARGET_LAST})
  string(JSON STMWEB_CANDIDATE_ID GET "${STMWEB_ADAPTER_JSON}" targets ${STMWEB_TARGET_INDEX} id)
  if(STMWEB_CANDIDATE_ID STREQUAL STMWEB_TARGET)
    string(JSON STMWEB_APP_LINKER GET "${STMWEB_ADAPTER_JSON}" targets ${STMWEB_TARGET_INDEX} applicationLinkerScript)
    string(JSON STMWEB_BOOT_LINKER GET "${STMWEB_ADAPTER_JSON}" targets ${STMWEB_TARGET_INDEX} bootloaderLinkerScript)
    string(JSON STMWEB_APPLICATION_BASE GET "${STMWEB_ADAPTER_JSON}" targets ${STMWEB_TARGET_INDEX} applicationBase)
    string(JSON STMWEB_APPLICATION_LIMIT GET "${STMWEB_ADAPTER_JSON}" targets ${STMWEB_TARGET_INDEX} applicationLimit)
    string(JSON STMWEB_FLASH_BYTES GET "${STMWEB_ADAPTER_JSON}" targets ${STMWEB_TARGET_INDEX} flashSize)
    string(JSON STMWEB_DEVICE_DEFINE GET "${STMWEB_ADAPTER_JSON}" targets ${STMWEB_TARGET_INDEX} deviceDefine)
    string(JSON STMWEB_COMPACT_RUNTIME GET "${STMWEB_ADAPTER_JSON}" targets ${STMWEB_TARGET_INDEX} compactRuntime)
    set(STMWEB_LINKER_SCRIPT "${CMAKE_CURRENT_LIST_DIR}/${STMWEB_APP_LINKER}")
    set(STMWEB_BOOTLOADER_LINKER_SCRIPT "${CMAKE_CURRENT_LIST_DIR}/${STMWEB_BOOT_LINKER}")
    math(EXPR STMWEB_EXPECTED_FLASH_KB "${STMWEB_FLASH_BYTES} / 1024")
    set(STMWEB_TARGET_FOUND ON)
  endif()
endforeach()
if(NOT STMWEB_TARGET_FOUND)
  message(FATAL_ERROR "STMWEB_TARGET is not registered by the DOT V1 adapter: ${STMWEB_TARGET}")
endif()
set(STMWEB_INITIAL_SWD_FIRMWARE ON)

if(NOT DEFINED STMWEB_SOURCE_ROOT)
  set(STMWEB_SOURCE_ROOT "${CMAKE_CURRENT_LIST_DIR}/source")
endif()
get_filename_component(STMWEB_SOURCE_ROOT "${STMWEB_SOURCE_ROOT}" ABSOLUTE)

set(DOT_SOURCES
  "${STMWEB_SOURCE_ROOT}/USER/DOT.c"
  "${STMWEB_SOURCE_ROOT}/USER/stm32f10x_it.c"
  "${STMWEB_SOURCE_ROOT}/USER/system_stm32f10x.c"
  "${CMAKE_CURRENT_LIST_DIR}/startup_stm32f103xb_gcc.s"
  "${CMAKE_CURRENT_LIST_DIR}/gcc_compat.c"
)

file(GLOB FWLIB_SOURCES CONFIGURE_DEPENDS "${STMWEB_SOURCE_ROOT}/STM32F10x_FWLib/src/*.c")
list(APPEND DOT_SOURCES ${FWLIB_SOURCES})

foreach(relative IN ITEMS
  SYSTEM/delay/delay.c SYSTEM/usart/usart.c
  DOT_HARDWARE/ADC/adc.c DOT_HARDWARE/ENCODER/encoder.c DOT_HARDWARE/EXTI/exti.c
  DOT_HARDWARE/IIC/IOI2C.c DOT_HARDWARE/KEY/key.c DOT_HARDWARE/MOTOR/motor.c
  DOT_HARDWARE/OLED/oled.c DOT_HARDWARE/TIMER/timer.c DOT_HARDWARE/USART3/usart3.c
  DOT_HARDWARE/DataScope_DP/DataScope_DP.C
  DOT_HARDWARE/MPU6050/MPU6050.c DOT_HARDWARE/LCD/lcd.c DOT_HARDWARE/LCD/lcd_init.c
  DOT_HARDWARE/USART2/usart2.c DOT/CONTROL/control.c DOT/DMP/inv_mpu.c
  DOT/DMP/inv_mpu_dmp_motion_driver.c DOT/filter/filter.c DOT/show/show.c
  DOT_HARDWARE/VL53L0X/core/src/vl53l0x_api.c
  DOT_HARDWARE/VL53L0X/core/src/vl53l0x_api_calibration.c
  DOT_HARDWARE/VL53L0X/core/src/vl53l0x_api_core.c
  DOT_HARDWARE/VL53L0X/core/src/vl53l0x_api_ranging.c
  DOT_HARDWARE/VL53L0X/core/src/vl53l0x_api_strings.c
  DOT_HARDWARE/VL53L0X/platform/src/vl53l0x_i2c.c
  DOT_HARDWARE/VL53L0X/platform/src/vl53l0x_platform.c
  DOT_HARDWARE/VL53L0X/demo/vl53l0x.c DOT_HARDWARE/VL53L0X/demo/vl53l0x_gen.c
  DOT_HARDWARE/VL53L0X/demo/vl53l0x_it.c DOT_HARDWARE/VL53L0X/demo/vl53l0x_cali.c
)
  list(APPEND DOT_SOURCES "${STMWEB_SOURCE_ROOT}/${relative}")
endforeach()

add_executable(dot_v1.elf ${DOT_SOURCES})
set_source_files_properties("${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/DataScope_DP/DataScope_DP.C" PROPERTIES LANGUAGE C)

if(STMWEB_INITIAL_SWD_FIRMWARE)
  target_sources(dot_v1.elf PRIVATE "${CMAKE_CURRENT_LIST_DIR}/stmweb_ota_bridge.c")
  set_source_files_properties(
    "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/USART3/usart3.c"
    PROPERTIES COMPILE_DEFINITIONS "communication=legacy_communication"
  )
endif()

if(STMWEB_COMPACT_RUNTIME)
  target_sources(dot_v1.elf PRIVATE "${CMAKE_CURRENT_LIST_DIR}/stmweb_compact_runtime.c")
  set_source_files_properties(
    "${STMWEB_SOURCE_ROOT}/DOT/CONTROL/control.c"
    PROPERTIES COMPILE_DEFINITIONS "sprintf=stmweb_compact_sprintf"
  )
  set_property(
    SOURCE "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/USART3/usart3.c"
    APPEND PROPERTY COMPILE_DEFINITIONS "strtod=stmweb_compact_strtod"
  )
  foreach(relative IN ITEMS
    DOT_HARDWARE/MPU6050/MPU6050.c
    DOT/DMP/inv_mpu.c DOT/DMP/inv_mpu_dmp_motion_driver.c
  )
    set_source_files_properties(
      "${STMWEB_SOURCE_ROOT}/${relative}"
      PROPERTIES COMPILE_DEFINITIONS "printf=stmweb_compact_printf"
    )
  endforeach()
endif()

target_include_directories(dot_v1.elf PRIVATE
  "${CMAKE_CURRENT_LIST_DIR}"
  "${STMWEB_SOURCE_ROOT}/USER" "${STMWEB_SOURCE_ROOT}/DOT_COER"
  "${STMWEB_SOURCE_ROOT}/STM32F10x_FWLib/inc" "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE"
  "${STMWEB_SOURCE_ROOT}/SYSTEM" "${STMWEB_SOURCE_ROOT}/SYSTEM/delay"
  "${STMWEB_SOURCE_ROOT}/SYSTEM/sys" "${STMWEB_SOURCE_ROOT}/SYSTEM/usart"
  "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/IIC" "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/ENCODER"
  "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/OLED" "${STMWEB_SOURCE_ROOT}/DOT/show"
  "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/LED" "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/KEY"
  "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/ADC" "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/MOTOR"
  "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/TIMER" "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/USART3"
  "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/EXTI" "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/DataScope_DP"
  "${STMWEB_SOURCE_ROOT}/DOT/filter" "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/STMFLASH"
  "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/DMP" "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/MPU6050"
  "${STMWEB_SOURCE_ROOT}/DOT/CONTROL" "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/LCD"
  "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/VL53L0X/core/inc"
  "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/VL53L0X/platform/inc"
  "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/VL53L0X/demo" "${STMWEB_SOURCE_ROOT}/DOT_HARDWARE/USART2"
)

target_compile_definitions(dot_v1.elf PRIVATE
  ${STMWEB_DEVICE_DEFINE} USE_STDPERIPH_DRIVER
  $<$<BOOL:${STMWEB_INITIAL_SWD_FIRMWARE}>:STMWEB_APPLICATION_BASE=${STMWEB_APPLICATION_BASE}>
)
target_compile_options(dot_v1.elf PRIVATE
  -mcpu=cortex-m3 -mthumb -Os -ffunction-sections -fdata-sections -fno-common
  -Wall -Wextra -Wno-unused-parameter -Wno-sign-compare -Wno-error=implicit-int
  "$<$<COMPILE_LANGUAGE:C>:-include${CMAKE_CURRENT_LIST_DIR}/gcc_compat.h>"
)
target_link_options(dot_v1.elf PRIVATE
  -mcpu=cortex-m3 -mthumb
  "-T${STMWEB_LINKER_SCRIPT}"
  -nostartfiles
  -Wl,--gc-sections -Wl,-Map=${CMAKE_CURRENT_BINARY_DIR}/dot_v1.map
)
target_link_libraries(dot_v1.elf PRIVATE m c nosys)

add_custom_command(TARGET dot_v1.elf POST_BUILD
  COMMAND ${ARM_OBJCOPY} -O ihex $<TARGET_FILE:dot_v1.elf> ${CMAKE_CURRENT_BINARY_DIR}/dot_v1.hex
  COMMAND ${ARM_OBJCOPY} -O binary $<TARGET_FILE:dot_v1.elf> ${CMAKE_CURRENT_BINARY_DIR}/dot_v1.bin
  COMMAND ${ARM_SIZE} $<TARGET_FILE:dot_v1.elf>
  VERBATIM
)

if(STMWEB_INITIAL_SWD_FIRMWARE)
  add_executable(dot_v1_bootloader.elf
    "${CMAKE_CURRENT_LIST_DIR}/startup_stm32f103xb_gcc.s"
    "${STMWEB_SOURCE_ROOT}/USER/system_stm32f10x.c"
    "${CMAKE_CURRENT_LIST_DIR}/stmweb_bootloader.c"
  )
  target_include_directories(dot_v1_bootloader.elf PRIVATE
    "${CMAKE_CURRENT_LIST_DIR}"
    "${STMWEB_SOURCE_ROOT}/USER"
    "${STMWEB_SOURCE_ROOT}/DOT_COER"
  )
  target_compile_definitions(dot_v1_bootloader.elf PRIVATE
    STM32F10X_MD
    STMWEB_APP_BASE=${STMWEB_APPLICATION_BASE}
    STMWEB_APP_LIMIT=${STMWEB_APPLICATION_LIMIT}
    STMWEB_METADATA_ADDRESS=${STMWEB_APPLICATION_LIMIT}
    STMWEB_EXPECTED_FLASH_KB=${STMWEB_EXPECTED_FLASH_KB}
  )
  target_compile_options(dot_v1_bootloader.elf PRIVATE
    -mcpu=cortex-m3 -mthumb -Os -ffreestanding -ffunction-sections -fdata-sections
    -Wall -Wextra -Werror
  )
  target_link_options(dot_v1_bootloader.elf PRIVATE
    -mcpu=cortex-m3 -mthumb
    "-T${STMWEB_BOOTLOADER_LINKER_SCRIPT}"
    -nostartfiles
    -Wl,--gc-sections -Wl,-Map=${CMAKE_CURRENT_BINARY_DIR}/dot_v1_bootloader.map
  )
  target_link_libraries(dot_v1_bootloader.elf PRIVATE c nosys)

  add_custom_command(TARGET dot_v1_bootloader.elf POST_BUILD
    COMMAND ${ARM_OBJCOPY} -O ihex $<TARGET_FILE:dot_v1_bootloader.elf> ${CMAKE_CURRENT_BINARY_DIR}/dot_v1_bootloader.hex
    COMMAND ${ARM_OBJCOPY} -O binary --remove-section=.factory_metadata $<TARGET_FILE:dot_v1_bootloader.elf> ${CMAKE_CURRENT_BINARY_DIR}/dot_v1_bootloader.bin
    COMMAND ${ARM_SIZE} $<TARGET_FILE:dot_v1_bootloader.elf>
    VERBATIM
  )

  add_custom_target(dot_v1_initial_swd ALL
    DEPENDS dot_v1.elf dot_v1_bootloader.elf
    COMMAND ${CMAKE_COMMAND}
      -DBOOTLOADER_HEX=${CMAKE_CURRENT_BINARY_DIR}/dot_v1_bootloader.hex
      -DAPPLICATION_HEX=${CMAKE_CURRENT_BINARY_DIR}/dot_v1.hex
      -DOUTPUT_HEX=${CMAKE_CURRENT_BINARY_DIR}/dot_v1_initial_swd.hex
      -P ${CMAKE_CURRENT_LIST_DIR}/merge_hex.cmake
    VERBATIM
  )
  add_custom_target(stmweb_firmware_package ALL
    DEPENDS dot_v1_initial_swd
    COMMAND ${NODE_EXECUTABLE} ${CMAKE_CURRENT_LIST_DIR}/write-package-manifest.mjs ${CMAKE_CURRENT_BINARY_DIR} ${STMWEB_TARGET}
    BYPRODUCTS ${CMAKE_CURRENT_BINARY_DIR}/stmweb_firmware_manifest.json
    VERBATIM
  )
endif()
