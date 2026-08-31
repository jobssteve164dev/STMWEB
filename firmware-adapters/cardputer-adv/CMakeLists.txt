cmake_minimum_required(VERSION 3.16)

set(STMWEB_ADAPTER_ROOT "${CMAKE_CURRENT_LIST_DIR}")
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(stmweb_cardputer_adv)

idf_build_get_property(build_dir BUILD_DIR)
idf_build_get_property(python PYTHON)

add_custom_target(stmweb_package ALL
  COMMAND "${python}" "${STMWEB_ADAPTER_ROOT}/merge_firmware.py"
    --build-dir "${build_dir}"
    --output "${build_dir}/cardputer_adv_complete.bin"
  COMMAND "${CMAKE_COMMAND}" -E copy
    "${build_dir}/${CMAKE_PROJECT_NAME}.bin"
    "${build_dir}/cardputer_adv_ota.bin"
  COMMAND node "${STMWEB_ADAPTER_ROOT}/write-package-manifest.mjs"
    "${build_dir}"
    "${STMWEB_COMPOSITION_FILE}"
  DEPENDS app
  VERBATIM)
