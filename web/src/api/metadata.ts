export const g_txModuleExternalDeviceTypeDict: Record<string, any> = {
    'MatekSys' :       { 'fname' : 'tx-matek',       'chipset' : 'stm32' },
    'FrSky R9' :       { 'fname' : 'tx-R9',          'chipset' : 'stm32' },
    'Wio E5' :         { 'fname' : 'tx-Wio-E5',      'chipset' : 'stm32' },
    'E77 MBL Kit' :    { 'fname' : 'tx-E77-MBLKit',  'chipset' : 'stm32' },
    'Easysolder' :     { 'fname' : 'tx-easysolder',  'chipset' : 'stm32' },
    'RadioMaster' :    { 'fname' : 'tx-radiomaster', 'chipset' : 'esp32' },
    'BetaFPV' :        { 'fname' : 'tx-betafpv',     'chipset' : 'esp32' },
};

export const g_receiverDeviceTypeDict: Record<string, any> = {
    'MatekSys' :       { 'fname' : 'rx-matek',       'chipset' : 'stm32' },
    'FrSky R9' :       { 'fname' : 'rx-R9',          'chipset' : 'stm32' },
    'Wio E5' :         { 'fname' : 'rx-Wio-E5',      'chipset' : 'stm32' },
    'E77 MBL Kit' :    { 'fname' : 'rx-E77-MBLKit',  'chipset' : 'stm32' },
    'Easysolder' :     { 'fname' : 'rx-easysolder',  'chipset' : 'stm32' },
    'RadioMaster' :    { 'fname' : 'rx-radiomaster', 'chipset' : 'espxx' },
    'BetaFPV' :        { 'fname' : 'rx-betafpv',     'chipset' : 'esp32' },
    'Bayck' :          { 'fname' : 'rx-bayck',       'chipset' : 'esp8285' },
    'SpeedyBee' :      { 'fname' : 'rx-speedybee',   'chipset' : 'esp8285' },
    'FlySky Radio' :   { 'fname' : 'rx-flysky',      'chipset' : 'esp32s3' },
    'ELRS Generic' :   { 'fname' : 'rx-generic',     'chipset' : 'espxx' },
};

export const g_txModuleInternalDeviceTypeDict: Record<string, any> = {
    'Jumper Radio' :      { 'fname' : 'tx-jumper-internal',      'chipset' : 'esp32' },
    'RadioMaster Radio' : { 'fname' : 'tx-radiomaster-internal', 'chipset' : 'esp32' },
    'FlySky Radio' :      { 'fname' : 'tx-flysky-internal',      'chipset' : 'esp32s3' },
};

const description_stm32_dfu_default = "Flash method: DFU\n  - connect to USB while pressing the button\n";
const description_stm32_stlink_default = "Flash method: STLink\n  - connect SWD pads to STLink\n";
const description_stm32_uart_default = "Flash method: UART\n  - connect Tx,Rx pads to USB-TTL adapter\n  - select COM port\n  - power up receiver while pressing the button\n";
const description_esp_esptool_uart_default = "Flash method: esptool\n  - connect Tx,Rx pads to USB-TTL adapter\n  - select COM port\n  - power up receiver while pressing the button\n";
const description_ardupilot_passthrough_default = "In addition flashing via ArduPilot passthrough is supported:\n  - follow the instructions in the console\n";
const description_radio_passthru_default = "  - with radio powered up, connect to USB of your radio\n  - select 'USB Serial (VCP)'\n";

export const g_targetDict: Record<string, any> = {
    'tx-matek' : {
        'flashmethod' : 'dfu',
        'description' : description_stm32_dfu_default + "\nWireless bridge: HC04, cannot be flashed\n",
    },
    'tx-R9' : {
        'description' : description_stm32_stlink_default + "mLRS Flasher currently only supports STLink.\nPlease see docs for more details.\n",
    },
    'tx-E77-MBLKit' : {
        'description' : description_stm32_stlink_default,
    },
    'tx-Wio-E5' : {
        'description' : description_stm32_stlink_default,
    },
    'tx-easysolder' : {
        'description' : description_stm32_stlink_default,
    },
    'tx-betafpv' : {
        'description' : "Not available (download failed)\n",
        'tx-betafpv-micro-1w-2400' : {
            'description' : "Flash method: connect to USB (select COM port)\n" +
                "\nWireless bridge: ESP8285\n" +
                "Dip switches need to be set as follow:\n" +
                "  1,2 on:    update firmware on main ESP32, USB connected to UARTO\n" +
                "  3,4 on:    normal operation mode, USB not used, UARTO connected to ESP8285\n" +
                "  5,6,7 on:  update firmware on ESP8285, USB connected to ESP8285 UART\n",
            'wireless' : { 'chipset' : 'esp8266', 'reset' : 'dtr', 'baud' : 921600 },
        },
    },
    'tx-radiomaster' : {
        'description' : "Not available (download failed)\n",
        'tx-radiomaster-bandit' : {
            'description' : "Flash method: connect to USB (select COM port)\n" +
                "\nWireless bridge: ESP8285\n" +
                "For flashing the wireless bridge, ensure the following settings are stored:\n" +
                "  - 'Tx Ser Dest' = serial2\n" +
                "  - 'Tx Ser Baudrate' = 115200\n" +
                "IMPORTANT: If using Windows - click 'Flash Wireless Bridge' first and wait for the module to reboot before the next step.\n" +
                "  - put Tx module into FLASH_ESP mode via OLED Actions page\n",
            'wireless' : { 'chipset' : 'esp8266', 'reset' : 'no dtr', 'baud' : 115200 },
        },
        'tx-radiomaster-nomad' : {
            'description' : "Flash method: connect to USB (select COM port)\n" +
                "\nWireless bridge: ESP32C3\n" +
                "For flashing the wireless bridge, ensure the following settings are stored:\n" +
                "  - 'Tx Ser Dest' = serial2\n" +
                "  - 'Tx Ser Baudrate' = 115200\n" +
                "IMPORTANT: If using Windows - click 'Flash Wireless Bridge' first and wait for the module to reboot before the next step.\n" +
                "  - put Tx module into FLASH_ESP by holding button located under the 'T' in RadioMaster for 4 seconds\n",
            'wireless' : { 'chipset' : 'esp32c3', 'reset' : 'no dtr', 'baud' : 115200, 'erase' : 'full_erase' },
        },
        'tx-radiomaster-ranger' : {
            'description' : "Flash method: connect to USB (select COM port)\n" +
                "\nWireless bridge: ESP8285\n" +
                "For flashing the wireless bridge, ensure the following settings are stored:\n" +
                "  - 'Tx Ser Dest' = serial2\n" +
                "  - 'Tx Ser Baudrate' = 115200\n" +
                "IMPORTANT: If using Windows - click 'Flash Wireless Bridge' first and wait for the module to reboot before the next step.\n" +
                "  - put Tx module into FLASH_ESP mode via OLED Actions page\n",
            'wireless' : { 'chipset' : 'esp8266', 'reset' : 'no dtr', 'baud' : 115200 },
        },
        'tx-radiomaster-rp4td' : {
            'description' : "No description yet. Please see docs for details.\n",
        },
    },
    'tx-jumper-internal' : {
        'description' : "Supported radios: T20 V2, T15, T14, T-Pro S\nFlash method: radio passthrough\n" + description_radio_passthru_default +
        
            "\nWireless bridge: ESP8285\nFor flashing the wireless bridge:\n" + description_radio_passthru_default,
        'wireless' : { 'chipset' : 'esp8266', 'baud' : 115200 },
    },
    'tx-radiomaster-internal' : {
        'description' : "Supported radios: TX16S, TX12, MT12, Zorro, Pocket, Boxer\nFlash method: radio passthrough\n" + description_radio_passthru_default +
            "\nWireless bridge: ESP8285\nFor flashing the wireless bridge:\n" + description_radio_passthru_default,
        'wireless' : { 'chipset' : 'esp8266', 'baud' : 115200 },
        'tx-radiomaster-internal-2400' : {
        },
        'tx-radiomaster-internal-boxer' : {
        },
        'tx-radiomaster-internal-tx15' : {
            'description' : "Supported radios: TX15\nFlash method: radio passthrough\n" + description_radio_passthru_default +
                "\nWireless bridge: ESP32C3\nFor flashing the wireless bridge:\n" + description_radio_passthru_default,
            'wireless' : { 'chipset' : 'esp32c3', 'baud' : 115200, 'erase' : 'full_erase' },
        },
        'tx-radiomaster-internal-gx12' : {
            'description' : "Supported radios: GX12\nFlash method: radio passthrough\n" + description_radio_passthru_default +
                "\nWireless bridge: ESP32C3\nFor flashing the wireless bridge:\n" + description_radio_passthru_default,
            'wireless' : { 'chipset' : 'esp32c3', 'baud' : 115200, 'erase' : 'full_erase' },
        },
    },
    'tx-flysky-internal' : {
        'description' : "Supported radios: PA01\nFlash method: radio passthrough\n" + description_radio_passthru_default +
            "\nWireless bridge: ESP32C3\nFor flashing the wireless bridge:\n" + description_radio_passthru_default,
        'wireless' : { 'chipset' : 'esp32c3', 'baud' : 115200, 'erase' : 'full_erase' },
    },
    'rx-matek' : {
        'flashmethod' : 'dfu,ardupilot_passthrough',
        'description' : description_stm32_dfu_default + description_ardupilot_passthrough_default,
        'rx-matek-mr900-22' : {
            'flashmethod' : 'stlink,uart,ardupilot_passthrough',
            'description' : description_stm32_stlink_default + description_stm32_uart_default + description_ardupilot_passthrough_default,
        },
    },
    'rx-R9' : {
        'description' : description_stm32_stlink_default + "mLRS Flasher currently only supports STLink.\nPlease see docs for more details.\n",
        'rx-R9MX-l433cb': {
            'flashmethod' : 'stlink,ardupilot_passthrough',
            'description' : description_stm32_stlink_default + description_ardupilot_passthrough_default,
        }
    },
    'rx-E77-MBLKit' : {
        'description' : description_stm32_stlink_default,
    },
    'rx-Wio-E5' : {
        'description' : description_stm32_stlink_default,
    },
    'rx-easysolder' : {
        'description' : description_stm32_stlink_default,
    },
    'rx-radiomaster' : {
        'flashmethod' : 'esptool,ardupilot_passthrough',
        'description' : description_esp_esptool_uart_default + description_ardupilot_passthrough_default,
        'rx-radiomaster-br3-900' : { 'chipset' : 'esp8285' },
        'rx-radiomaster-rp4td-2400' : { 'chipset' : 'esp32' },
        'rx-radiomaster-xr1' : { 'chipset' : 'esp32c3' },
        'rx-radiomaster-xr4' : { 'chipset' : 'esp32' },
    },
    'rx-betafpv' : {
        'chipset' : 'esp32',
        'flashmethod' : 'esptool,ardupilot_passthrough',
        'description' : description_esp_esptool_uart_default + description_ardupilot_passthrough_default,
    },
    'rx-bayck' : {
        'chipset' : 'esp8285',
        'flashmethod' : 'esptool,ardupilot_passthrough',
        'description' : description_esp_esptool_uart_default + description_ardupilot_passthrough_default,
    },
    'rx-speedybee' : {
        'chipset' : 'esp8285',
        'flashmethod' : 'esptool,ardupilot_passthrough',
        'description' : description_esp_esptool_uart_default + description_ardupilot_passthrough_default,
    },
    'rx-flysky' : {
        'chipset' : 'esp32s3',
        'flashmethod' : 'esptool,ardupilot_passthrough',
        'description' : description_esp_esptool_uart_default + description_ardupilot_passthrough_default,
        'rx-flysky-pr02-2400' : {
            'chipset' : 'esp32s3',
        },
    },
    'rx-generic' : {
        'flashmethod' : 'esptool,ardupilot_passthrough',
        'description' : description_esp_esptool_uart_default + description_ardupilot_passthrough_default,
        'chipset' : 'esp8285',
        'rx-generic-2400-td-pa' : { 'chipset' : 'esp32' },
        'rx-generic-900-td-pa' : { 'chipset' : 'esp32' },
        'rx-generic-c3' : { 'chipset' : 'esp32c3' },
        'rx-generic-lr1121-td' : { 'chipset' : 'esp32' },
    },
};

export const FIRMWARE_JSON_URL = 'https://raw.githubusercontent.com/olliw42/mLRS/refs/heads/main/tools/web/mlrs_firmware_urls.json';
export const REPOSITORY_TREE_URL = 'https://api.github.com/repos/olliw42/mLRS/git/trees/';
export const MAIN_BRANCH_TREE_URL = 'https://api.github.com/repos/olliw42/mLRS/git/trees/main';
export const WIRELESSBRIDGE_PATH_URL = 'https://raw.githubusercontent.com/olliw42/mLRS/refs/heads/main/firmware/wirelessbridge/';

export function resolveChipset(deviceDict: any, targetDict: any, filename: string): string {
    let chipset = deviceDict.chipset || 'stm32';
    
    if (targetDict.chipset) {
        chipset = targetDict.chipset;
    }
        
    for (const key in targetDict) {
        if (filename.includes(key)) {
            const subVal = targetDict[key];
            if (typeof subVal === 'object' && subVal.chipset) {
                chipset = subVal.chipset;
            }
            break;
        }
    }
            
    return chipset;
}

export function getDeviceInfo(deviceName: string, deviceType?: string) {
    let deviceDict: any = {};
    let targetDict: any = {};
    
    let dictsToSearch: any[] = [];
    if (deviceType === 'tx') {
        dictsToSearch = [g_txModuleExternalDeviceTypeDict];
    } else if (deviceType === 'rx') {
        dictsToSearch = [g_receiverDeviceTypeDict];
    } else if (deviceType === 'txint') {
        dictsToSearch = [g_txModuleInternalDeviceTypeDict];
    } else {
        dictsToSearch = [
            g_txModuleExternalDeviceTypeDict, 
            g_receiverDeviceTypeDict, 
            g_txModuleInternalDeviceTypeDict
        ];
    }

    for (const d of dictsToSearch) {
        if (d[deviceName]) {
            deviceDict = d[deviceName];
            const fname = deviceDict.fname || '';
            targetDict = g_targetDict[fname] || {};
            break;
        }
    }
            
    return { deviceDict, targetDict };
}
