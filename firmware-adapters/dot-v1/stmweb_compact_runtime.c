#include <stdarg.h>
#include <stdint.h>

static void writeUnsigned(char *output, uint32_t value, uint8_t width) {
  for (uint8_t index = width; index > 0u; index--) {
    output[index - 1u] = (char)('0' + value % 10u);
    value /= 10u;
  }
}

static void writeFloatPrefix(char *output, double input) {
  uint8_t position = 0u;
  const uint8_t negative = input < 0.0;
  const double absolute = negative ? -input : input;
  uint32_t whole = (uint32_t)absolute;
  uint32_t fraction = (uint32_t)((absolute - (double)whole) * 1000000.0 + 0.5);
  if (fraction >= 1000000u) { whole++; fraction = 0u; }
  if (negative) output[position++] = '-';

  uint32_t divisor = 1u;
  while (divisor <= whole / 10u) divisor *= 10u;
  do {
    output[position++] = (char)('0' + whole / divisor % 10u);
    divisor /= 10u;
  } while (divisor != 0u && position < 5u);
  if (position < 5u) output[position++] = '.';
  divisor = 100000u;
  while (position < 5u) {
    output[position++] = (char)('0' + fraction / divisor % 10u);
    divisor /= 10u;
  }
}

int stmweb_compact_sprintf(char *output, const char *format, ...) {
  va_list arguments;
  va_start(arguments, format);
  if (format[0] == '%' && format[1] == '0' && (format[2] == '4' || format[2] == '5') && format[3] == 'd') {
    const uint8_t width = (uint8_t)(format[2] - '0');
    int32_t value = va_arg(arguments, int);
    const uint8_t negative = value < 0;
    uint32_t magnitude = negative ? (uint32_t)(-(int64_t)value) : (uint32_t)value;
    if (negative) {
      output[0] = '-';
      writeUnsigned(output + 1, magnitude, (uint8_t)(width - 1u));
    } else {
      writeUnsigned(output, magnitude, width);
    }
    va_end(arguments);
    return width;
  }
  if (format[0] == '%' && format[1] == 'f') {
    const double input = va_arg(arguments, double);
    writeFloatPrefix(output, input);
    va_end(arguments);
    return 5;
  }
  va_end(arguments);
  return 0;
}

double stmweb_compact_strtod(const char *input, char **end) {
  uint8_t negative = 0u;
  double value = 0.0;
  double divisor = 1.0;
  if (*input == '-') { negative = 1u; input++; }
  else if (*input == '+') input++;
  while (*input >= '0' && *input <= '9') value = value * 10.0 + (double)(*input++ - '0');
  if (*input == '.') {
    input++;
    while (*input >= '0' && *input <= '9') {
      value = value * 10.0 + (double)(*input++ - '0');
      divisor *= 10.0;
    }
  }
  if (end != 0) *end = (char *)input;
  value /= divisor;
  return negative ? -value : value;
}

int stmweb_compact_printf(const char *format, ...) {
  (void)format;
  return 0;
}
