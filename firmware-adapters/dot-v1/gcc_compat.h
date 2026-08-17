#pragma once

#if defined(__GNUC__)
#define __packed __attribute__((packed))
#endif

#ifndef STMWEB_APPLICATION_BASE
#define STMWEB_APPLICATION_BASE 0x08000000u
#endif
