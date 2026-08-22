#include <stdint.h>

__attribute__((used, section(".stmweb_config")))
const uint8_t stmweb_firmware_configuration[] =
  "STMWEB_CONFIG:{\"schemaVersion\":1,\"foundationModules\":[\"platform.boot-recovery\",\"platform.device-identity\",\"platform.debug-safety\"],\"capabilityModules\":[\"capability.motor-control\",\"capability.battery\",\"capability.tuning\",\"capability.telemetry\"],\"connectionModules\":[\"connection.swd\",\"connection.bluetooth\"],\"flashMethods\":[\"swd\",\"bluetooth\"]}";
