// intel hex file parser
// parses intel hex format into memory blocks with addresses

export interface MemoryBlock {
    address: number;
    data: Uint8Array;
}

/**
 * parse intel hex format text into memory blocks
 * supports record types: 00 (data), 01 (eof), 02 (extended segment), 04 (extended linear)
 */
export function parseHex(hexText: string): MemoryBlock[] {
    const blocks: MemoryBlock[] = [];
    
    const lines = hexText.split(/\r?\n/);
    let highAddress = 0;
    let currentBuffer: number[] = [];
    let startAddress = -1;

    for (const line of lines) {
        if (line.length === 0 || line[0] !== ':') continue;
        
        // parse basic fields
        const byteCount = parseInt(line.substring(1, 3), 16);
        const address = parseInt(line.substring(3, 7), 16);
        const recordType = parseInt(line.substring(7, 9), 16);
        const dataHex = line.substring(9, 9 + byteCount * 2);

        if (isNaN(byteCount) || isNaN(address) || isNaN(recordType)) {
             continue;
        }

        if (recordType === 0x00) { // data record
            const absAddress = highAddress + address;
            
            // check continuity
            if (startAddress === -1) {
                startAddress = absAddress;
            } else if (absAddress !== startAddress + currentBuffer.length) {
                // gap detected, flush previous block
                if (currentBuffer.length > 0) {
                    blocks.push({ address: startAddress, data: new Uint8Array(currentBuffer) });
                }
                startAddress = absAddress;
                currentBuffer = [];
            }

            for (let i = 0; i < byteCount; i++) {
                currentBuffer.push(parseInt(dataHex.substring(i * 2, i * 2 + 2), 16));
            }

        } else if (recordType === 0x01) { // end of file
            // flush any remaining data
            if (currentBuffer.length > 0) {
                blocks.push({ address: startAddress, data: new Uint8Array(currentBuffer) });
            }
            break; // stop parsing

        } else if (recordType === 0x02) { // extended segment address
             // (segment << 4)
             const segment = parseInt(dataHex.substring(0, 4), 16);
             highAddress = segment << 4;
             if (currentBuffer.length > 0) {
                blocks.push({ address: startAddress, data: new Uint8Array(currentBuffer) });
                startAddress = -1;
                currentBuffer = [];
             }

        } else if (recordType === 0x04) { // extended linear address
             // (upper << 16)
             const upper = parseInt(dataHex.substring(0, 4), 16);
             highAddress = upper << 16;
             
             if (currentBuffer.length > 0) {
                blocks.push({ address: startAddress, data: new Uint8Array(currentBuffer) });
                startAddress = -1;
                currentBuffer = [];
             }
        }
    }
    
    if (currentBuffer.length > 0) {
         const lastAdded = blocks.length > 0 ? blocks[blocks.length-1] : null;
         if (!lastAdded || lastAdded.address !== startAddress) {
             blocks.push({ address: startAddress, data: new Uint8Array(currentBuffer) });
         }
    }

    return blocks;
}
