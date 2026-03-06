#!/usr/bin/env node
import { createNodeHiDockClient } from './dist/nodeUsb.js';

(async () => {
  try {
    const client = await createNodeHiDockClient();
    await client.open();
    const result = await client.listFiles();
    await client.close();

    if (!result || !Array.isArray(result.files)) {
      console.error('No files retrieved or unexpected data');
      process.exit(1);
    }

    console.log(`Total recordings on P1: ${result.files.length}`);
    for (const f of result.files) {
      console.log(`${f.fileName} (${(f.fileSize/1024/1024).toFixed(1)} MB)`);
    }
  } catch (err) {
    const msg = String(err?.message || err || 'unknown error');
    console.error('Failed to list P1 recordings:', err);

    if (msg.includes('LIBUSB_ERROR_ACCESS')) {
      console.error('\nTroubleshooting LIBUSB_ERROR_ACCESS:');
      console.error('1) Check that HiDock P1 is plugged in.');
      console.error('2) Check whether HiNotes is open in Chrome/browser; it may occupy the USB device. Close it and retry.');
    }

    process.exit(1);
  }
})();