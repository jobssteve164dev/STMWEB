ENTRY(Reset_Handler)

MEMORY
{
  FLASH (rx)  : ORIGIN = 0x08004000, LENGTH = 111K
  RAM   (rwx) : ORIGIN = 0x20000000, LENGTH = 20K
}

_estack = ORIGIN(RAM) + LENGTH(RAM);
_flash_start = ORIGIN(FLASH);
_Min_Heap_Size = 0x200;
_Min_Stack_Size = 0x400;

SECTIONS
{
  .isr_vector : { KEEP(*(.isr_vector)) } > FLASH
  .text :
  {
    *(.text*) *(.rodata*)
    KEEP(*(.init)) KEEP(*(.fini))
    . = ALIGN(4);
    _etext = .;
  } > FLASH
  .ARM.extab : { *(.ARM.extab* .gnu.linkonce.armextab.*) } > FLASH
  .ARM.exidx :
  {
    __exidx_start = .;
    *(.ARM.exidx* .gnu.linkonce.armexidx.*)
    __exidx_end = .;
    . = ALIGN(4);
    _sidata = .;
  } > FLASH
  .data : AT(_sidata)
  {
    . = ALIGN(4); _sdata = .;
    *(.data*)
    . = ALIGN(4); _edata = .;
  } > RAM
  .bss (NOLOAD) :
  {
    . = ALIGN(4); _sbss = .;
    *(.bss*) *(COMMON)
    . = ALIGN(4); _ebss = .;
    end = .;
  } > RAM
  ._user_heap_stack (NOLOAD) :
  {
    . = ALIGN(8);
    . += _Min_Heap_Size;
    . += _Min_Stack_Size;
    . = ALIGN(8);
  } > RAM
  /DISCARD/ : { *(.note*) *(.comment*) }
}
