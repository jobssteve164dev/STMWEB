#include "cardputer_hardware.h"

#include <stdio.h>
#include <string.h>

#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/spi_master.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_vendor.h"
#include "esp_log.h"
#include "esp_timer.h"

#define LCD_WIDTH 240
#define LCD_HEIGHT 135
#define LCD_PIN_BL GPIO_NUM_38
#define LCD_PIN_RST GPIO_NUM_33
#define LCD_PIN_DC GPIO_NUM_34
#define LCD_PIN_MOSI GPIO_NUM_35
#define LCD_PIN_SCLK GPIO_NUM_36
#define LCD_PIN_CS GPIO_NUM_37
#define OTA_AUTHORIZE_PIN GPIO_NUM_0
#define OTA_AUTHORIZATION_WINDOW_US 60000000

#define KEYBOARD_ADDRESS 0x34
#define KEYBOARD_PIN_SDA GPIO_NUM_8
#define KEYBOARD_PIN_SCL GPIO_NUM_9
#define TCA_REG_CFG 0x01
#define TCA_REG_INT_STAT 0x02
#define TCA_REG_KEY_LCK_EC 0x03
#define TCA_REG_KEY_EVENT_A 0x04
#define TCA_REG_KP_GPIO_1 0x1d
#define TCA_REG_KP_GPIO_2 0x1e

static const char *TAG = "cardputer-hw";
static cardputer_text_sink_t text_sink;
static i2c_master_dev_handle_t keyboard_device;
static adc_oneshot_unit_handle_t adc_handle;
static uint16_t *framebuffer;
static bool pressed[4][14];
static int64_t last_battery_at;
static int ota_authorize_level = 1;
static int64_t ota_authorized_until;
static portMUX_TYPE ota_authorization_lock = portMUX_INITIALIZER_UNLOCKED;

static const char *const key_names[4][14] = {
    {"`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", "backspace"},
    {"tab", "q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]", "\\"},
    {"fn", "shift", "a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'", "enter"},
    {"ctrl", "opt", "alt", "z", "x", "c", "v", "b", "n", "m", ",", ".", "/", "space"},
};

static uint16_t rgb565(uint8_t red, uint8_t green, uint8_t blue)
{
    uint16_t value = (uint16_t)(((red & 0xf8) << 8) | ((green & 0xfc) << 3) | (blue >> 3));
    return (uint16_t)((value << 8) | (value >> 8));
}

static const uint8_t *glyph(char value)
{
    static const uint8_t blank[5] = {0};
    static const uint8_t A[5] = {0x7e,0x11,0x11,0x11,0x7e}; static const uint8_t B[5] = {0x7f,0x49,0x49,0x49,0x36};
    static const uint8_t C[5] = {0x3e,0x41,0x41,0x41,0x22}; static const uint8_t D[5] = {0x7f,0x41,0x41,0x22,0x1c};
    static const uint8_t E[5] = {0x7f,0x49,0x49,0x49,0x41}; static const uint8_t F[5] = {0x7f,0x09,0x09,0x09,0x01};
    static const uint8_t I[5] = {0x41,0x41,0x7f,0x41,0x41}; static const uint8_t K[5] = {0x7f,0x08,0x14,0x22,0x41};
    static const uint8_t L[5] = {0x7f,0x40,0x40,0x40,0x40}; static const uint8_t M[5] = {0x7f,0x02,0x0c,0x02,0x7f};
    static const uint8_t N[5] = {0x7f,0x04,0x08,0x10,0x7f}; static const uint8_t O[5] = {0x3e,0x41,0x41,0x41,0x3e};
    static const uint8_t P[5] = {0x7f,0x09,0x09,0x09,0x06}; static const uint8_t R[5] = {0x7f,0x09,0x19,0x29,0x46};
    static const uint8_t S[5] = {0x46,0x49,0x49,0x49,0x31}; static const uint8_t T[5] = {0x01,0x01,0x7f,0x01,0x01};
    static const uint8_t U[5] = {0x3f,0x40,0x40,0x40,0x3f}; static const uint8_t V[5] = {0x1f,0x20,0x40,0x20,0x1f};
    static const uint8_t W[5] = {0x7f,0x20,0x18,0x20,0x7f}; static const uint8_t Y[5] = {0x07,0x08,0x70,0x08,0x07};
    switch (value) {
    case 'A': return A; case 'B': return B; case 'C': return C; case 'D': return D; case 'E': return E; case 'F': return F;
    case 'I': return I; case 'K': return K; case 'L': return L; case 'M': return M; case 'N': return N; case 'O': return O;
    case 'P': return P; case 'R': return R; case 'S': return S; case 'T': return T; case 'U': return U; case 'V': return V;
    case 'W': return W; case 'Y': return Y; default: return blank;
    }
}

static void draw_text(int x, int y, const char *text, uint16_t color, int scale)
{
    while (*text) {
        const uint8_t *columns = glyph(*text++);
        for (int column = 0; column < 5; column++) {
            for (int row = 0; row < 7; row++) {
                if ((columns[column] & (1U << row)) == 0) continue;
                for (int sy = 0; sy < scale; sy++) for (int sx = 0; sx < scale; sx++) {
                    int px = x + column * scale + sx;
                    int py = y + row * scale + sy;
                    if (px >= 0 && px < LCD_WIDTH && py >= 0 && py < LCD_HEIGHT) framebuffer[py * LCD_WIDTH + px] = color;
                }
            }
        }
        x += 6 * scale;
    }
}

static void display_init(void)
{
    gpio_config_t backlight = {.pin_bit_mask = 1ULL << LCD_PIN_BL, .mode = GPIO_MODE_OUTPUT};
    ESP_ERROR_CHECK(gpio_config(&backlight));
    gpio_set_level(LCD_PIN_BL, 0);

    spi_bus_config_t bus = {.sclk_io_num = LCD_PIN_SCLK, .mosi_io_num = LCD_PIN_MOSI, .miso_io_num = -1,
        .quadwp_io_num = -1, .quadhd_io_num = -1, .max_transfer_sz = LCD_WIDTH * LCD_HEIGHT * 2};
    ESP_ERROR_CHECK(spi_bus_initialize(SPI2_HOST, &bus, SPI_DMA_CH_AUTO));
    esp_lcd_panel_io_handle_t io = NULL;
    esp_lcd_panel_io_spi_config_t io_config = {.dc_gpio_num = LCD_PIN_DC, .cs_gpio_num = LCD_PIN_CS,
        .pclk_hz = 40000000, .lcd_cmd_bits = 8, .lcd_param_bits = 8, .spi_mode = 0, .trans_queue_depth = 4};
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_spi(SPI2_HOST, &io_config, &io));
    esp_lcd_panel_handle_t panel = NULL;
    esp_lcd_panel_dev_config_t panel_config = {.reset_gpio_num = LCD_PIN_RST, .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB, .bits_per_pixel = 16};
    ESP_ERROR_CHECK(esp_lcd_new_panel_st7789(io, &panel_config, &panel));
    ESP_ERROR_CHECK(esp_lcd_panel_reset(panel));
    ESP_ERROR_CHECK(esp_lcd_panel_init(panel));
    ESP_ERROR_CHECK(esp_lcd_panel_invert_color(panel, true));
    ESP_ERROR_CHECK(esp_lcd_panel_swap_xy(panel, true));
    ESP_ERROR_CHECK(esp_lcd_panel_mirror(panel, true, false));
    ESP_ERROR_CHECK(esp_lcd_panel_set_gap(panel, 40, 52));
    ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(panel, true));

    framebuffer = heap_caps_calloc(LCD_WIDTH * LCD_HEIGHT, sizeof(uint16_t), MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL);
    ESP_ERROR_CHECK(framebuffer ? ESP_OK : ESP_ERR_NO_MEM);
    uint16_t background = rgb565(11, 16, 32);
    for (size_t index = 0; index < LCD_WIDTH * LCD_HEIGHT; index++) framebuffer[index] = background;
    draw_text(12, 17, "STMWEB", rgb565(96, 165, 250), 3);
    draw_text(12, 50, "CARDPUTER ADV", rgb565(241, 245, 249), 2);
    draw_text(12, 80, "BLE READY", rgb565(74, 222, 128), 2);
    draw_text(12, 108, "PRESS ANY KEY", rgb565(148, 163, 184), 1);
    ESP_ERROR_CHECK(esp_lcd_panel_draw_bitmap(panel, 0, 0, LCD_WIDTH, LCD_HEIGHT, framebuffer));
    gpio_set_level(LCD_PIN_BL, 1);
}

static esp_err_t tca_write(uint8_t reg, uint8_t value)
{
    uint8_t bytes[2] = {reg, value};
    return i2c_master_transmit(keyboard_device, bytes, sizeof(bytes), 100);
}

static esp_err_t tca_read(uint8_t reg, uint8_t *value)
{
    return i2c_master_transmit_receive(keyboard_device, &reg, 1, value, 1, 100);
}

static void keyboard_init(void)
{
    i2c_master_bus_config_t bus_config = {.i2c_port = I2C_NUM_0, .sda_io_num = KEYBOARD_PIN_SDA,
        .scl_io_num = KEYBOARD_PIN_SCL, .clk_source = I2C_CLK_SRC_DEFAULT, .glitch_ignore_cnt = 7,
        .flags.enable_internal_pullup = true};
    i2c_master_bus_handle_t bus;
    ESP_ERROR_CHECK(i2c_new_master_bus(&bus_config, &bus));
    i2c_device_config_t device_config = {.dev_addr_length = I2C_ADDR_BIT_LEN_7, .device_address = KEYBOARD_ADDRESS, .scl_speed_hz = 400000};
    ESP_ERROR_CHECK(i2c_master_bus_add_device(bus, &device_config, &keyboard_device));
    ESP_ERROR_CHECK(tca_write(TCA_REG_KP_GPIO_1, 0x7f));
    ESP_ERROR_CHECK(tca_write(TCA_REG_KP_GPIO_2, 0xff));
    uint8_t event;
    do { ESP_ERROR_CHECK(tca_read(TCA_REG_KEY_EVENT_A, &event)); } while (event != 0);
    ESP_ERROR_CHECK(tca_write(TCA_REG_INT_STAT, 0x03));
    ESP_ERROR_CHECK(tca_write(TCA_REG_CFG, 0x01));
}

static void battery_init(void)
{
    adc_oneshot_unit_init_cfg_t config = {.unit_id = ADC_UNIT_1};
    ESP_ERROR_CHECK(adc_oneshot_new_unit(&config, &adc_handle));
    adc_oneshot_chan_cfg_t channel = {.atten = ADC_ATTEN_DB_12, .bitwidth = ADC_BITWIDTH_12};
    ESP_ERROR_CHECK(adc_oneshot_config_channel(adc_handle, ADC_CHANNEL_9, &channel));
}

static void ota_authorization_init(void)
{
    gpio_config_t button = {
        .pin_bit_mask = 1ULL << OTA_AUTHORIZE_PIN,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&button));
    ota_authorize_level = gpio_get_level(OTA_AUTHORIZE_PIN);
}

static void ota_authorization_poll(void)
{
    int level = gpio_get_level(OTA_AUTHORIZE_PIN);
    if (ota_authorize_level == 1 && level == 0) {
        portENTER_CRITICAL(&ota_authorization_lock);
        ota_authorized_until = esp_timer_get_time() + OTA_AUTHORIZATION_WINDOW_US;
        portEXIT_CRITICAL(&ota_authorization_lock);
        if (text_sink) text_sink("STMWEB_OTA_AUTHORIZED:60\n");
    }
    ota_authorize_level = level;
}

static void publish_keys(void)
{
    if (!text_sink) return;
    char message[768];
    size_t used = (size_t)snprintf(message, sizeof(message), "STMWEB_KEYS:{\"pressed\":[");
    bool first = true;
    for (int row = 0; row < 4; row++) for (int column = 0; column < 14; column++) {
        if (!pressed[row][column]) continue;
        const char *name = key_names[row][column];
        used += (size_t)snprintf(message + used, sizeof(message) - used, "%s\"%s%s\"", first ? "" : ",",
            strcmp(name, "\\") == 0 ? "\\" : "", name);
        first = false;
    }
    used += (size_t)snprintf(message + used, sizeof(message) - used, "],\"modifiers\":[");
    first = true;
    const int modifier_rows[] = {2, 2, 3, 3, 3};
    const int modifier_columns[] = {0, 1, 0, 1, 2};
    const char *modifier_names[] = {"fn", "shift", "ctrl", "opt", "alt"};
    for (size_t index = 0; index < 5; index++) {
        if (!pressed[modifier_rows[index]][modifier_columns[index]]) continue;
        used += (size_t)snprintf(message + used, sizeof(message) - used, "%s\"%s\"", first ? "" : ",", modifier_names[index]);
        first = false;
    }
    snprintf(message + used, sizeof(message) - used, "]}\n");
    text_sink(message);
}

static void keyboard_poll(void)
{
    uint8_t count = 0;
    if (tca_read(TCA_REG_KEY_LCK_EC, &count) != ESP_OK) return;
    count &= 0x0f;
    bool changed = false;
    while (count-- > 0) {
        uint8_t event = 0;
        if (tca_read(TCA_REG_KEY_EVENT_A, &event) != ESP_OK || (event & 0x7f) == 0) break;
        bool is_pressed = (event & 0x80) != 0;
        uint8_t raw = (uint8_t)((event & 0x7f) - 1);
        uint8_t raw_row = raw / 10;
        uint8_t raw_column = raw % 10;
        uint8_t column = (uint8_t)(raw_row * 2 + (raw_column > 3 ? 1 : 0));
        uint8_t row = (uint8_t)((raw_column + 4) % 4);
        if (row < 4 && column < 14) { pressed[row][column] = is_pressed; changed = true; }
    }
    if (changed) publish_keys();
    tca_write(TCA_REG_INT_STAT, 0x01);
}

static void battery_poll(void)
{
    int64_t now = esp_timer_get_time();
    if (now - last_battery_at < 5000000) return;
    last_battery_at = now;
    int raw = 0;
    if (adc_oneshot_read(adc_handle, ADC_CHANNEL_9, &raw) != ESP_OK) return;
    float voltage = (float)raw * 3.3f * 2.0f / 4095.0f;
    int percent = (int)((voltage - 3.3f) * 100.0f / 0.9f);
    if (percent < 0) percent = 0;
    if (percent > 100) percent = 100;
    if (text_sink) {
        char message[96];
        snprintf(message, sizeof(message), "STMWEB_BATTERY:{\"voltage\":%.2f,\"percent\":%d}\n", voltage, percent);
        text_sink(message);
    }
}

void cardputer_hardware_init(void)
{
    display_init();
    keyboard_init();
    battery_init();
    ota_authorization_init();
}

void cardputer_hardware_set_sink(cardputer_text_sink_t sink) { text_sink = sink; }
void cardputer_hardware_poll(void) { keyboard_poll(); battery_poll(); ota_authorization_poll(); }

bool cardputer_hardware_consume_ota_authorization(void)
{
    int64_t authorized_until;
    portENTER_CRITICAL(&ota_authorization_lock);
    authorized_until = ota_authorized_until;
    ota_authorized_until = 0;
    portEXIT_CRITICAL(&ota_authorization_lock);
    return authorized_until >= esp_timer_get_time();
}

void cardputer_hardware_set_ota_progress(uint8_t percent)
{
    ESP_LOGI(TAG, "BLE OTA %u%%", percent);
}
