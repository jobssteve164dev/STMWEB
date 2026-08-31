#include "cardputer_ble_ota.h"

#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include "esp_ota_ops.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "host/ble_hs.h"
#include "host/util/util.h"
#include "mbedtls/sha256.h"
#include "nimble/nimble_port.h"
#include "nimble/nimble_port_freertos.h"
#include "os/os_mbuf.h"
#include "services/gap/ble_svc_gap.h"
#include "services/gatt/ble_svc_gatt.h"
#include "store/config/ble_store_config.h"

#include "cardputer_hardware.h"

void ble_store_config_init(void);

#define OTA_BEGIN 0xa0
#define OTA_DATA 0xa1
#define OTA_COMMIT 0xa2
#define OTA_ACK 0xb0

static uint16_t notify_value_handle;
static uint16_t write_value_handle;
static uint16_t connection_handle = BLE_HS_CONN_HANDLE_NONE;
static bool notify_enabled;
static uint8_t own_address_type;

static esp_ota_handle_t ota_handle;
static const esp_partition_t *ota_partition;
static uint32_t ota_size;
static uint32_t ota_offset;
static uint8_t ota_expected_sha[32];
static mbedtls_sha256_context ota_sha;
static bool ota_active;

static const ble_uuid16_t service_uuid = BLE_UUID16_INIT(0xfff0);
static const ble_uuid16_t notify_uuid = BLE_UUID16_INIT(0xfff1);
static const ble_uuid16_t write_uuid = BLE_UUID16_INIT(0xfff2);

static void notify_session_state(void)
{
    cardputer_ble_notify_text("STMWEB_CAPS:{\"schemaVersion\":1,\"device\":{\"id\":\"cardputer-adv\",\"model\":\"M5Stack Cardputer ADV\",\"firmwareVersion\":\"1.0.0\"},\"capabilities\":[{\"id\":\"screen\",\"type\":\"display\",\"label\":\"数字孪生屏幕\",\"status\":\"online\",\"channels\":[\"revision\",\"background\",\"lines\"]},{\"id\":\"keyboard\",\"type\":\"keyboard\",\"label\":\"56 键键盘\",\"status\":\"online\",\"channels\":[\"pressed\",\"modifiers\"]},{\"id\":\"battery\",\"type\":\"battery\",\"label\":\"电池电压\",\"status\":\"online\",\"channels\":[\"voltage\"]}]}\n");
    cardputer_ble_notify_text("STMWEB_SCREEN:{\"revision\":1,\"background\":\"#0b1020\",\"lines\":[\"STMWEB\",\"CARDPUTER ADV\",\"BLE READY\",\"PRESS ANY KEY\"]}\n");
    cardputer_ble_notify_text("STMWEB_READY:stmweb.cardputer-adv:1.0.0\n");
}

static uint32_t read_u32_le(const uint8_t *bytes)
{
    return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) | ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
}

static void write_u32_le(uint8_t *bytes, uint32_t value)
{
    bytes[0] = value & 0xff; bytes[1] = (value >> 8) & 0xff; bytes[2] = (value >> 16) & 0xff; bytes[3] = (value >> 24) & 0xff;
}

static void notify_bytes(const uint8_t *bytes, size_t length)
{
    if (!notify_enabled || connection_handle == BLE_HS_CONN_HANDLE_NONE) return;
    struct os_mbuf *packet = ble_hs_mbuf_from_flat(bytes, length);
    if (packet) ble_gatts_notify_custom(connection_handle, notify_value_handle, packet);
}

void cardputer_ble_notify_text(const char *text)
{
    size_t remaining = strlen(text);
    while (remaining > 0) {
        size_t length = remaining > 160 ? 160 : remaining;
        notify_bytes((const uint8_t *)text, length);
        text += length;
        remaining -= length;
    }
}

static void ota_ack(uint8_t status, uint8_t command, uint32_t acknowledged_offset)
{
    uint8_t response[7] = {OTA_ACK, status, command};
    write_u32_le(response + 3, acknowledged_offset);
    notify_bytes(response, sizeof(response));
}

static void ota_abort(void)
{
    if (ota_active) esp_ota_abort(ota_handle);
    ota_active = false;
    ota_offset = 0;
    mbedtls_sha256_free(&ota_sha);
}

static void restart_task(void *unused)
{
    (void)unused;
    vTaskDelay(pdMS_TO_TICKS(800));
    esp_restart();
}

static int ota_command(const uint8_t *bytes, uint16_t length)
{
    if (length == 0) return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
    uint8_t command = bytes[0];
    esp_err_t result = ESP_OK;
    if (command == OTA_BEGIN) {
        if (length != 37) return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        if (ota_active || !cardputer_hardware_consume_ota_authorization()) result = ESP_ERR_INVALID_STATE;
        ota_size = read_u32_le(bytes + 1);
        memcpy(ota_expected_sha, bytes + 5, sizeof(ota_expected_sha));
        ota_partition = esp_ota_get_next_update_partition(NULL);
        if (result == ESP_OK && (!ota_partition || ota_size < 128 || ota_size > ota_partition->size)) result = ESP_ERR_INVALID_SIZE;
        if (result == ESP_OK) result = esp_ota_begin(ota_partition, ota_size, &ota_handle);
        if (result == ESP_OK) {
            mbedtls_sha256_init(&ota_sha);
            if (mbedtls_sha256_starts(&ota_sha, 0) != 0) result = ESP_FAIL;
        }
        ota_active = result == ESP_OK;
        ota_offset = 0;
    } else if (command == OTA_DATA) {
        if (!ota_active || length <= 5 || read_u32_le(bytes + 1) != ota_offset || ota_offset + length - 5 > ota_size) result = ESP_ERR_INVALID_STATE;
        if (result == ESP_OK) result = esp_ota_write(ota_handle, bytes + 5, length - 5);
        if (result == ESP_OK && mbedtls_sha256_update(&ota_sha, bytes + 5, length - 5) != 0) result = ESP_FAIL;
        if (result == ESP_OK) {
            ota_offset += length - 5;
            cardputer_hardware_set_ota_progress((uint8_t)((uint64_t)ota_offset * 100 / ota_size));
        }
    } else if (command == OTA_COMMIT) {
        uint8_t actual_sha[32];
        if (!ota_active || length != 1 || ota_offset != ota_size) result = ESP_ERR_INVALID_STATE;
        if (result == ESP_OK && mbedtls_sha256_finish(&ota_sha, actual_sha) != 0) result = ESP_FAIL;
        if (result == ESP_OK && memcmp(actual_sha, ota_expected_sha, sizeof(actual_sha)) != 0) result = ESP_ERR_INVALID_CRC;
        if (result == ESP_OK) result = esp_ota_end(ota_handle);
        if (result == ESP_OK) result = esp_ota_set_boot_partition(ota_partition);
        ota_active = false;
        mbedtls_sha256_free(&ota_sha);
    } else {
        return BLE_ATT_ERR_REQ_NOT_SUPPORTED;
    }

    ota_ack(result == ESP_OK ? 0 : 1, command, command == OTA_COMMIT ? 0 : ota_offset);
    if (result != ESP_OK) {
        ota_abort();
    } else if (command == OTA_COMMIT) {
        cardputer_ble_notify_text("STMWEB_READY:stmweb.cardputer-adv:1.0.0:restart-scheduled\n");
        xTaskCreate(restart_task, "ota-restart", 2048, NULL, 5, NULL);
    }
    return 0;
}

static int gatt_access(uint16_t conn_handle, uint16_t attr_handle, struct ble_gatt_access_ctxt *context, void *arg)
{
    (void)conn_handle; (void)arg;
    if (context->op == BLE_GATT_ACCESS_OP_READ_CHR && attr_handle == notify_value_handle) {
        static const char ready[] = "STMWEB_READY:stmweb.cardputer-adv:1.0.0\n";
        return os_mbuf_append(context->om, ready, sizeof(ready) - 1) == 0 ? 0 : BLE_ATT_ERR_INSUFFICIENT_RES;
    }
    if (context->op == BLE_GATT_ACCESS_OP_WRITE_CHR && attr_handle == write_value_handle) {
        uint16_t length = OS_MBUF_PKTLEN(context->om);
        uint8_t buffer[256];
        if (length > sizeof(buffer) || ble_hs_mbuf_to_flat(context->om, buffer, sizeof(buffer), NULL) != 0) return BLE_ATT_ERR_INVALID_ATTR_VALUE_LEN;
        return ota_command(buffer, length);
    }
    return BLE_ATT_ERR_UNLIKELY;
}

static const struct ble_gatt_svc_def services[] = {{
    .type = BLE_GATT_SVC_TYPE_PRIMARY,
    .uuid = &service_uuid.u,
    .characteristics = (struct ble_gatt_chr_def[]) {{
        .uuid = &notify_uuid.u, .access_cb = gatt_access,
        .flags = BLE_GATT_CHR_F_READ | BLE_GATT_CHR_F_READ_ENC | BLE_GATT_CHR_F_NOTIFY,
        .val_handle = &notify_value_handle,
    }, {
        .uuid = &write_uuid.u, .access_cb = gatt_access,
        .flags = BLE_GATT_CHR_F_WRITE | BLE_GATT_CHR_F_WRITE_NO_RSP | BLE_GATT_CHR_F_WRITE_ENC,
        .val_handle = &write_value_handle,
    }, {0}},
}, {0}};

static void advertise(void);

static int gap_event(struct ble_gap_event *event, void *arg)
{
    (void)arg;
    switch (event->type) {
    case BLE_GAP_EVENT_CONNECT:
        if (event->connect.status == 0) connection_handle = event->connect.conn_handle;
        else advertise();
        return 0;
    case BLE_GAP_EVENT_DISCONNECT:
        ota_abort();
        connection_handle = BLE_HS_CONN_HANDLE_NONE;
        notify_enabled = false;
        advertise();
        return 0;
    case BLE_GAP_EVENT_SUBSCRIBE:
        if (event->subscribe.attr_handle == notify_value_handle) {
            notify_enabled = event->subscribe.cur_notify != 0;
            if (notify_enabled) notify_session_state();
        }
        return 0;
    case BLE_GAP_EVENT_ADV_COMPLETE:
        advertise();
        return 0;
    default:
        return 0;
    }
}

static void advertise(void)
{
    struct ble_hs_adv_fields fields = {0};
    fields.flags = BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP;
    const char *name = ble_svc_gap_device_name();
    fields.name = (uint8_t *)name;
    fields.name_len = strlen(name);
    fields.name_is_complete = true;
    fields.uuids16 = (ble_uuid16_t[]){service_uuid};
    fields.num_uuids16 = 1;
    fields.uuids16_is_complete = true;
    ble_gap_adv_set_fields(&fields);
    struct ble_gap_adv_params params = {.conn_mode = BLE_GAP_CONN_MODE_UND, .disc_mode = BLE_GAP_DISC_MODE_GEN};
    ble_gap_adv_start(own_address_type, NULL, BLE_HS_FOREVER, &params, gap_event, NULL);
}

static void on_sync(void)
{
    if (ble_hs_util_ensure_addr(0) != 0) return;
    if (ble_hs_id_infer_auto(0, &own_address_type) != 0) return;
    advertise();
}

static void host_task(void *unused)
{
    (void)unused;
    nimble_port_run();
    nimble_port_freertos_deinit();
}

esp_err_t cardputer_ble_ota_init(void)
{
    esp_err_t result = nimble_port_init();
    if (result != ESP_OK) return result;
    ble_svc_gap_init();
    ble_svc_gatt_init();
    if (ble_svc_gap_device_name_set("STMWEB Cardputer ADV") != 0) return ESP_FAIL;
    if (ble_gatts_count_cfg(services) != 0 || ble_gatts_add_svcs(services) != 0) return ESP_FAIL;
    ble_hs_cfg.sync_cb = on_sync;
    ble_hs_cfg.sm_bonding = 1;
    ble_hs_cfg.sm_sc = 1;
    ble_hs_cfg.sm_io_cap = BLE_HS_IO_NO_INPUT_OUTPUT;
    ble_store_config_init();
    ble_att_set_preferred_mtu(256);
    nimble_port_freertos_init(host_task);
    return ESP_OK;
}
