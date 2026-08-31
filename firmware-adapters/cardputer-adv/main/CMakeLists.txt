set(stmweb_sources "main.c" "cardputer_hardware.c" "cardputer_ble_ota.c")
if(DEFINED STMWEB_CONFIGURATION_SOURCE AND EXISTS "${STMWEB_CONFIGURATION_SOURCE}")
  list(APPEND stmweb_sources "${STMWEB_CONFIGURATION_SOURCE}")
endif()

idf_component_register(
  SRCS ${stmweb_sources}
  INCLUDE_DIRS "."
  REQUIRES app_update bt esp_adc esp_driver_gpio esp_driver_i2c esp_driver_spi esp_lcd mbedtls nvs_flash)

target_compile_definitions(${COMPONENT_LIB} PRIVATE
  STMWEB_ADAPTER_MARKER="STMWEB_ADAPTER:stmweb.cardputer-adv"
  STMWEB_FIRMWARE_VERSION="1.0.0")
