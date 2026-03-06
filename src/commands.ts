export const HiDockCommand = {
  QUERY_DEVICE_INFO: 0x0001,
  QUERY_DEVICE_TIME: 0x0002,
  QUERY_FILE_LIST: 0x0004,
  TRANSFER_FILE: 0x0005,
  QUERY_FILE_COUNT: 0x0006,
  TRANSFER_FILE_HEAD: 0x000d,
  TRANSFER_FILE_RANGE: 0x0015,
} as const;

export type HiDockCommandCode = (typeof HiDockCommand)[keyof typeof HiDockCommand];
