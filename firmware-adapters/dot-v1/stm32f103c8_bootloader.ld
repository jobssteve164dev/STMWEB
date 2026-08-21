ENTRY(Reset_Handler)

MEMORY
{
  BOOT (rx)   : ORIGIN = 0x08000000, LENGTH = 4K
  META (rx)   : ORIGIN = 0x0800FC00, LENGTH = 1K
  RAM  (rwx)  : ORIGIN = 0x20000000, LENGTH = 20K
}

_estack = ORIGIN(RAM) + LENGTH(RAM);
_flash_start = ORIGIN(BOOT);

SECTIONS
{
  .isr_vector : { KEEP(*(.isr_vector)) } > BOOT
  .text :
  {
    *(.text*) *(.rodata*)
    . = ALIGN(4); _etext = .;
  } > BOOT
  .ARM.extab : { *(.ARM.extab* .gnu.linkonce.armextab.*) } > BOOT
  .ARM.exidx :
  {
    __exidx_start = .; *(.ARM.exidx* .gnu.linkonce.armexidx.*) __exidx_end = .;
    . = ALIGN(4); _sidata = .;
  } > BOOT
  .data : AT(_sidata)
  {
    . = ALIGN(4); _sdata = .; *(.data*) . = ALIGN(4); _edata = .;
  } > RAM
  .bss (NOLOAD) :
  {
    . = ALIGN(4); _sbss = .; *(.bss*) *(COMMON) . = ALIGN(4); _ebss = .;
  } > RAM
  .factory_metadata : { KEEP(*(.factory_metadata)) } > META
  /DISCARD/ : { *(.note*) *(.comment*) }
}
