#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef void (*cardputer_text_sink_t)(const char *text);

void cardputer_hardware_init(void);
void cardputer_hardware_set_sink(cardputer_text_sink_t sink);
void cardputer_hardware_poll(void);
void cardputer_hardware_set_ota_progress(uint8_t percent);
bool cardputer_hardware_consume_ota_authorization(void);
