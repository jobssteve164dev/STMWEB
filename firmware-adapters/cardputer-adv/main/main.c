#include <stdio.h>

#include "esp_log.h"
#include "esp_ota_ops.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"

#include "cardputer_ble_ota.h"
#include "cardputer_hardware.h"

static const char *TAG = "stmweb-cardputer";
__attribute__((used)) static const char adapter_marker[] = STMWEB_ADAPTER_MARKER;

static void publish(const char *text)
{
    fputs(text, stdout);
    cardputer_ble_notify_text(text);
}

void app_main(void)
{
    esp_err_t result = nvs_flash_init();
    if (result == ESP_ERR_NVS_NO_FREE_PAGES || result == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        result = nvs_flash_init();
    }
    ESP_ERROR_CHECK(result);

    cardputer_hardware_init();
    cardputer_hardware_set_sink(publish);
    ESP_ERROR_CHECK(cardputer_ble_ota_init());
    result = esp_ota_mark_app_valid_cancel_rollback();
    if (result != ESP_OK && result != ESP_ERR_INVALID_STATE) ESP_LOGW(TAG, "Unable to confirm running OTA image: %s", esp_err_to_name(result));

    publish("STMWEB_CAPS:{\"schemaVersion\":1,\"device\":{\"id\":\"cardputer-adv\",\"model\":\"M5Stack Cardputer ADV\",\"firmwareVersion\":\"1.0.0\"},\"capabilities\":[{\"id\":\"screen\",\"type\":\"display\",\"label\":\"数字孪生屏幕\",\"status\":\"online\",\"channels\":[\"revision\",\"background\",\"lines\"]},{\"id\":\"keyboard\",\"type\":\"keyboard\",\"label\":\"56 键键盘\",\"status\":\"online\",\"channels\":[\"pressed\",\"modifiers\"]},{\"id\":\"battery\",\"type\":\"battery\",\"label\":\"电池电压\",\"status\":\"online\",\"channels\":[\"voltage\"]}]}\n");
    publish("STMWEB_SCREEN:{\"revision\":1,\"background\":\"#0b1020\",\"lines\":[\"STMWEB\",\"CARDPUTER ADV\",\"BLE READY\",\"PRESS ANY KEY\"]}\n");
    publish("STMWEB_READY:stmweb.cardputer-adv:1.0.0\n");
    ESP_LOGI(TAG, "Cardputer ADV adapter ready: %s", adapter_marker);

    while (true) {
        cardputer_hardware_poll();
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}
