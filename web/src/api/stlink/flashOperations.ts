// flash operations for stm32 via st-link/swd
// date: 2026-01-14

import { StlinkDevice } from './stlinkDevice';
import type { LogCallback, ProgressCallback, FlashDriverConfig } from './types';
import { FLASH_BASE } from './chipDatabase';

// flash keys (same for all stm32 families)
const FLASH_KEY1 = 0x45670123;
const FLASH_KEY2 = 0xcdef89ab;

// flash cr bits (common/generic naming)
const FLASH_CR_PG = 0x0001;      // programming
const FLASH_CR_PER = 0x0002;     // page erase
const FLASH_CR_STRT_F1 = 0x0040; // start (f1/f3)
const FLASH_CR_STRT_L4 = 0x10000; // start (l4/g4/wl - bit 16)
const FLASH_CR_LOCK = 0x0080;    // lock (f1/f3)
const FLASH_CR_LOCK_L4 = 0x80000000; // lock (l4/g4/wl - bit 31)

// flash sr bits
const FLASH_SR_BSY = 0x0001;     // busy (f1/f3)
const FLASH_SR_BSY_L4 = 0x10000; // busy (l4/g4/wl - bit 16)

// flash error bits (f1/f3)
const FLASH_SR_PGERR = 0x0004;    // programming error
const FLASH_SR_WRPRTERR = 0x0010; // write protection error

// flash error bits (l4/g4/wl)
const FLASH_SR_OPERR = 0x0002;    // operation error
const FLASH_SR_PROGERR = 0x0008;  // programming error
const FLASH_SR_WRPERR = 0x0010;   // write protection error
const FLASH_SR_PGAERR = 0x0020;   // programming alignment error
const FLASH_SR_SIZERR = 0x0040;   // size error
const FLASH_SR_PGSERR = 0x0080;   // programming sequence error
const FLASH_SR_MISERR = 0x0100;   // fast programming data miss error
const FLASH_SR_FASTERR = 0x4000;  // fast programming error

/**
 * flash programmer for stm32 via st-link/swd
 */
export class FlashOperations {
  private device: StlinkDevice;
  private log: LogCallback;
  private config: FlashDriverConfig;

  constructor(device: StlinkDevice, log?: LogCallback) {
    this.device = device;
    this.log = log || (() => {});
    
    if (!device.chipInfo?.flashConfig) {
      throw new Error('Chip flash configuration not found');
    }
    this.config = device.chipInfo.flashConfig;
    
    this.log('debug', `Flash Driver: ${this.config.type} (Width: ${this.config.programWidth}-bit, Method: ${this.config.eraseMethod})`);
  }

  /**
   * unlock flash for writing
   */
  async unlockFlash(): Promise<void> {
    this.log('debug', 'Unlocking flash...');

    // KEYR offset: F1/F3=0x04, L4/G4/WL=0x08
    const keyrOffset = (this.config.type === 'F1' || this.config.type === 'F3') ? 0x04 : 0x08;
    const crOffset = this.config.crOffset;

    const keyrReg = this.config.registerBase + keyrOffset;
    const crReg = this.config.registerBase + crOffset;
    
    // check lock bit
    const crVal = await this.readFlashReg(crReg);
    const lockBit = (this.config.type === 'F1' || this.config.type === 'F3') ? FLASH_CR_LOCK : FLASH_CR_LOCK_L4;

    if (!(crVal & lockBit)) {
      this.log('debug', 'Flash already unlocked');
      return;
    }

    // write unlock sequence
    await this.writeFlashReg(keyrReg, FLASH_KEY1);
    await this.writeFlashReg(keyrReg, FLASH_KEY2);

    // verify unlock
    const crValAfter = await this.readFlashReg(crReg);
    if (crValAfter & lockBit) {
      throw new Error('Failed to unlock flash');
    }

    this.log('debug', 'Flash unlocked');
  }

  /**
   * lock flash after writing
   */
  async lockFlash(): Promise<void> {
    this.log('debug', 'Locking flash...');

    const crReg = this.config.registerBase + this.config.crOffset;
    const lockBit = (this.config.type === 'F1' || this.config.type === 'F3') ? FLASH_CR_LOCK : FLASH_CR_LOCK_L4;

    const crVal = await this.readFlashReg(crReg);
    await this.writeFlashReg(crReg, crVal | lockBit);

    this.log('debug', 'Flash locked');
  }

  /**
   * check for flash errors
   */
  private async checkFlashErrors(): Promise<void> {
    const srReg = this.config.registerBase + this.config.srOffset;
    const status = await this.readFlashReg(srReg);

    if (this.config.type === 'F1' || this.config.type === 'F3') {
      if (status & FLASH_SR_WRPRTERR) throw new Error('Flash Error: Write Protection (WRPRTERR)');
      if (status & FLASH_SR_PGERR) throw new Error('Flash Error: Programming (PGERR)');
    } else {
      // L4/G4/WL
      if (status & FLASH_SR_OPERR) throw new Error('Flash Error: Operation (OPERR)');
      if (status & FLASH_SR_PROGERR) throw new Error('Flash Error: Programming (PROGERR)');
      if (status & FLASH_SR_WRPERR) throw new Error('Flash Error: Write Protection (WRPERR)');
      if (status & FLASH_SR_PGAERR) throw new Error('Flash Error: Alignment (PGAERR)');
      if (status & FLASH_SR_SIZERR) throw new Error('Flash Error: Size (SIZERR)');
      if (status & FLASH_SR_PGSERR) throw new Error('Flash Error: Sequence (PGSERR)');
      if (status & FLASH_SR_MISERR) throw new Error('Flash Error: Data Miss (MISERR)');
      if (status & FLASH_SR_FASTERR) throw new Error('Flash Error: Fast Program (FASTERR)');
    }
  }

  /**
   * wait for flash operation to complete
   */
  private async waitFlashBusy(timeout = 10000): Promise<void> {
    const srReg = this.config.registerBase + this.config.srOffset;
    const bsyBit = (this.config.type === 'F1' || this.config.type === 'F3') ? FLASH_SR_BSY : FLASH_SR_BSY_L4;
    
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const status = await this.readFlashReg(srReg);

      if (!(status & bsyBit)) {
        // operation complete, check for errors
        await this.checkFlashErrors();
        return;
      }

      await this.delay(1);
    }

    throw new Error('Flash operation timeout');
  }

  /**
   * clear flash status register errors
   */
  async clearFlashErrors(): Promise<void> {
    const srReg = this.config.registerBase + this.config.srOffset;
    
    // clear all error flags by writing 1s (w1c - write 1 to clear)
    // mask varies by family:
    // F1/F3: SR bits 2,4,5 (PGERR, WRPRTERR, EOP)
    // L4/G4/WL: SR bits 1,3,4,5,6,7,8,14,15 (OPERR, PROGERR, WRPERR, PGAERR, SIZERR, PGSERR, MISERR, FASTERR, OPTVERR)
    // WLE5 special: same as L4 basically
    
    let clearMask: number;
    if (this.config.type === 'F1' || this.config.type === 'F3') {
      // F1/F3: PGERR(2) | WRPRTERR(4) | EOP(5) = 0x34
      clearMask = 0x34;
    } else {
      // L4/G4/WL: clear bits 1,3-8,14-15 = 0xC1FA
      // bit layout: OPERR(1), PROGERR(3), WRPERR(4), PGAERR(5), SIZERR(6), PGSERR(7), MISERR(8), FASTERR(14), OPTVERR(15)
      clearMask = 0xC1FA;
    }
    
    await this.writeFlashReg(srReg, clearMask);
  }

  /**
   * erase a single flash page
   */
  async erasePage(pageAddress: number): Promise<void> {
    const crReg = this.config.registerBase + this.config.crOffset;
    
    await this.clearFlashErrors();

    if (this.config.eraseMethod === 'AR') {
      // F1/F3 Method: CR_PER -> AR=addr -> CR_STRT
      const arReg = this.config.registerBase + 0x14; // AR offset is 0x14 for F1/F3
      
      // set PER
      await this.writeFlashReg(crReg, FLASH_CR_PER);
      // set AR
      await this.writeFlashReg(arReg, pageAddress);
      // start
      await this.writeFlashReg(crReg, FLASH_CR_PER | FLASH_CR_STRT_F1);
      
      await this.waitFlashBusy();
      
      // clear PER
      await this.writeFlashReg(crReg, 0);

    } else if (this.config.eraseMethod === 'CR_PNB') {
      // L4/G4/WL Method: CR_PER | (PNB << shift) -> CR_STRT
      // calculate page index. Address relative to flash base / page size.
      const pageIndex = Math.floor((pageAddress - FLASH_BASE) / this.device.chipInfo!.flashPageSize);
      const shift = this.config.pnbShift || 3;
      
      const crVal = FLASH_CR_PER | (pageIndex << shift);
      
      // write CR with PER and PNB
      await this.writeFlashReg(crReg, crVal);
      // start (keep PER and PNB, add STRT)
      await this.writeFlashReg(crReg, crVal | FLASH_CR_STRT_L4);
      
      await this.waitFlashBusy();
      
      // clear CR
      await this.writeFlashReg(crReg, 0);
    }
  }

  /**
   * erase multiple pages
   */
  async erasePages(
    startAddress: number,
    size: number,
    pageSize: number,
    onProgress?: ProgressCallback
  ): Promise<void> {
    const numPages = Math.ceil(size / pageSize);
    this.log('info', `Erasing ${numPages} pages starting at 0x${startAddress.toString(16)}...`);

    for (let i = 0; i < numPages; i++) {
      const pageAddr = startAddress + i * pageSize;
      await this.erasePage(pageAddr);

      if (onProgress) {
        const percent = Math.round(((i + 1) / numPages) * 100);
        onProgress(percent, `Erasing page ${i + 1}/${numPages}`);
      }
    }
  }

  /**
   * program flash with data
   */
  async programFlash(
    address: number,
    data: Uint8Array,
    onProgress?: ProgressCallback
  ): Promise<void> {
    const crReg = this.config.registerBase + this.config.crOffset;
    const width = this.config.programWidth;
    const widthBytes = width / 8;

    this.log('info', `Programming ${data.length} bytes at 0x${address.toString(16)} (${width}-bit mode)...`);

    await this.clearFlashErrors();

    // pad data
    const paddedLen = (data.length + widthBytes - 1) & ~(widthBytes - 1);
    const paddedData = new Uint8Array(paddedLen);
    paddedData.fill(0xff);
    paddedData.set(data);

    // enable programming
    await this.writeFlashReg(crReg, FLASH_CR_PG);

    let written = 0;
    let lastProgressUpdate = 0;

    for (let offset = 0; offset < paddedLen; offset += widthBytes) {
      const chunk = paddedData.slice(offset, offset + widthBytes);
      const targetAddr = address + offset;

      if (width === 16) {
        // 16-bit write (F1)
        await this.device.writeMem16(targetAddr, chunk);
      } else if (width === 32) {
        // 32-bit write (F3)
        await this.device.writeMem32(targetAddr, chunk);
      } else if (width === 64) {
        // 64-bit write (L4/G4/WL) - requires two 32-bit writes or a specific 64-bit write sequence?
        // ST-Link API v2 supports 32-bit writes. Usually 64-bit flash allows two 32-bit writes to fill the buffer.
        // Wait, for L4, "Double-word programming" means two words must be written.
        // Or we can use `writeMem32` twice? Yes, usually.
        // But the flash waits for the full 64-bits.
        // Important: writes must be atomic or sequential?
        // Standard WebUSB transfer splits data anyway.
        // Let's try writing 8 bytes as a single block using writeMem32 (writes 2 words).
        // StlinkDevice.writeMem32 takes a buffer.
        await this.device.writeMem32(targetAddr, chunk);
      }

      // wait for busy
      await this.waitFlashBusy();

      written += widthBytes;

      if (onProgress && (written - lastProgressUpdate >= 1024 || written >= paddedLen)) {
        const percent = Math.round((written / paddedLen) * 100);
        onProgress(percent, `Programming: ${Math.floor(written / 1024)}KB`);
        lastProgressUpdate = written;
      }
    }

    // disable programming
    await this.writeFlashReg(crReg, 0);

    this.log('info', 'Programming complete');
  }

  /**
   * verify flash contents match data
   */
  async verifyFlash(
    address: number,
    data: Uint8Array,
    onProgress?: ProgressCallback
  ): Promise<boolean> {
    this.log('info', `Verifying ${data.length} bytes at 0x${address.toString(16)}...`);

    const chunkSize = 4096;
    let verified = 0;

    for (let offset = 0; offset < data.length; offset += chunkSize) {
      const len = Math.min(chunkSize, data.length - offset);
      const readData = await this.device.readMem32(address + offset, len);

      // compare
      for (let i = 0; i < len; i++) {
        if (readData[i] !== data[offset + i]) {
          const addr = address + offset + i;
          this.log(
            'error',
            `Verification failed at 0x${addr.toString(16)}: expected 0x${data[offset + i].toString(16)}, got 0x${readData[i].toString(16)}`
          );
          return false;
        }
      }

      verified += len;

      if (onProgress) {
        const percent = Math.round((verified / data.length) * 100);
        onProgress(percent, `Verifying: ${Math.floor(verified / 1024)}KB`);
      }
    }

    this.log('info', 'Verification successful');
    return true;
  }

  /**
   * full flash operation: erase, program, verify
   */
  async flashFirmware(
    address: number,
    data: Uint8Array,
    pageSize: number,
    onProgress?: ProgressCallback
  ): Promise<void> {
    try {
      // halt cpu first
      this.log('info', 'Halting CPU...');
      await this.device.halt();

      // unlock flash
      await this.unlockFlash();

      // erase required pages
      onProgress?.(0, 'Erasing...');
      await this.erasePages(address, data.length, pageSize, (pct, status) => {
        onProgress?.(Math.round(pct * 0.3), status); // 0-30%
      });

      // program
      onProgress?.(30, 'Programming...');
      await this.programFlash(address, data, (pct, status) => {
        onProgress?.(30 + Math.round(pct * 0.4), status); // 30-70%
      });

      // verify
      onProgress?.(70, 'Verifying...');
      const verified = await this.verifyFlash(address, data, (pct, status) => {
        onProgress?.(70 + Math.round(pct * 0.3), status); // 70-100%
      });

      if (!verified) {
        throw new Error('Verification failed');
      }

      // lock flash
      await this.lockFlash();
      await this.delay(10);

      // reset and run target to start the new firmware
      this.log('info', 'Verification successful. Resetting target...');
      await this.device.reset();
      await this.device.run();

      onProgress?.(100, 'Complete!');
      this.log('info', 'Flash complete and target reset!');
    } catch (err) {
      // try to lock flash on error
      try {
        await this.lockFlash();
      } catch {
        // ignore
      }
      throw err;
    }
  }

  // helper methods
  private async readFlashReg(addr: number): Promise<number> {
    const data = await this.device.readMem32(addr, 4);
    return data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24);
  }

  private async writeFlashReg(addr: number, value: number): Promise<void> {
    const data = new Uint8Array(4);
    data[0] = value & 0xff;
    data[1] = (value >> 8) & 0xff;
    data[2] = (value >> 16) & 0xff;
    data[3] = (value >> 24) & 0xff;
    await this.device.writeMem32(addr, data);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
