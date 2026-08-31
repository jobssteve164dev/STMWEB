#pragma once

#include "esp_err.h"

esp_err_t cardputer_ble_ota_init(void);
void cardputer_ble_notify_text(const char *text);
