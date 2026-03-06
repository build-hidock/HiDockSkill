#!/usr/bin/env node
/**
 * Comprehensive HiDock device diagnostic — exercises all read-only protocol commands.
 */
import { createNodeHiDockClient } from '../dist/nodeUsb.js';

async function main() {
  const client = await createNodeHiDockClient();
  await client.open();

  try {
    console.log('=== HiDock Device Diagnostic ===\n');

    // 1) Device Info (0x0001)
    const info = await client.getDeviceInfo();
    console.log('[OK] Device Info');
    console.log(`     Firmware : ${info.version}`);
    console.log(`     Serial   : ${info.serialNumber}`);

    // 2) Device Time (0x0002)
    const time = await client.getDeviceTime();
    console.log(`[OK] Device Time`);
    console.log(`     BCD      : ${time.bcdDateTime ?? '(not set)'}`);

    // 3) File Count (0x0006)
    const count = await client.getFileCount();
    console.log(`[OK] File Count`);
    console.log(`     Files    : ${count}`);

    // 4) File List (0x0004)
    const list = await client.listFiles();
    console.log(`[OK] File List`);
    console.log(`     Entries  : ${list.files.length}`);

    if (list.files.length > 0) {
      for (const f of list.files) {
        const dur = f.estimatedDurationSeconds != null
          ? `~${Math.round(f.estimatedDurationSeconds)}s`
          : '?';
        console.log(`     - ${f.fileName}  (${(f.fileSize / 1024 / 1024).toFixed(2)} MB, ${dur}, ${f.audioProfile?.codec ?? 'unknown'})`);
      }

      // 5) Download first chunk of last file (0x0005)
      const target = list.files[list.files.length - 1];
      const head = await client.readFileHead(target, 64);
      console.log(`[OK] File Head (0x000d) — first 64 bytes of "${target.fileName}"`);
      console.log(`     Hex      : ${Array.from(head.subarray(0, 32), b => b.toString(16).padStart(2, '0')).join(' ')}...`);
    } else {
      console.log('     (no files to download — device storage is empty)');
    }

    console.log('\n=== All protocol commands succeeded ===');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Diagnostic failed:', err.message);
  process.exitCode = 1;
});
