import serial
import serial.tools.list_ports
import time
import struct
import sys

# MSP Codes
MSP_CF_SERIAL_CONFIG = 54
MSP2_COMMON_SERIAL_CONFIG = 0x1009

def list_ports():
    ports = serial.tools.list_ports.comports()
    return [p.device for p in ports]

def crc8_dvb_s2(data):
    crc = 0
    for byte in data:
        crc ^= byte
        for _ in range(8):
            if crc & 0x80:
                crc = ((crc << 1) ^ 0xD5) & 0xFF
            else:
                crc = (crc << 1) & 0xFF
    return crc

def send_msp_v2(ser, cmd, payload=[]):
    flag = 0
    size = len(payload)
    
    # Flag + Cmd(LE) + Size(LE) + Payload
    crc_data = [
        flag,
        cmd & 0xFF, (cmd >> 8) & 0xFF,
        size & 0xFF, (size >> 8) & 0xFF
    ] + payload
    
    crc = crc8_dvb_s2(crc_data)
    
    # $X< 
    header = [0x24, 0x58, 0x3c]
    packet = bytes(header + crc_data + [crc])
    
    print(f"Sending MSP V2 Cmd {cmd}: {packet.hex(' ')}")
    ser.write(packet)
    
    # Read response
    # Header $X>
    while True:
        if ser.in_waiting > 0:
            break
        time.sleep(0.01)

    header_resp = ser.read(3)
    print(f"Header: {header_resp.decode('ascii', errors='replace')}")
    
    if header_resp != b'$X>':
        print("Invalid header or error")
        return

    flag_resp = ser.read(1)[0]
    func_bytes = ser.read(2)
    func = func_bytes[0] | (func_bytes[1] << 8)
    size_bytes = ser.read(2)
    payload_size = size_bytes[0] | (size_bytes[1] << 8)
    
    print(f"Response: Cmd={func}, Size={payload_size}")
    
    payload_resp = ser.read(payload_size)
    crc_resp = ser.read(1)[0]
    
    print(f"Payload: {payload_resp.hex(' ')}")

def send_msp_v1(ser, cmd, payload=[]):
    size = len(payload)
    checksum = size ^ cmd
    for b in payload:
        checksum ^= b
        
    # $M< 
    header = [0x24, 0x4d, 0x3c]
    packet = bytes(header + [size, cmd] + payload + [checksum])
    
    print(f"Sending MSP V1 Cmd {cmd}: {packet.hex(' ')}")
    ser.write(packet)
    
    time.sleep(0.1) 
    
    if ser.in_waiting == 0:
        print("No response received")
        return

    header_resp = ser.read(3)
    print(f"Header: {header_resp}")
    
    if header_resp != b'$M>':
        print(f"Invalid header: {header_resp}")
        return
        
    size_resp = ser.read(1)[0]
    cmd_resp = ser.read(1)[0]
    
    print(f"Response: Cmd={cmd_resp}, Size={size_resp}")
    
    payload_resp = ser.read(size_resp)
    checksum_resp = ser.read(1)[0]
    
    print(f"Payload: {payload_resp.hex(' ')}")

def main():
    ports = list_ports()
    if not ports:
        print("No serial ports found")
        return

    print("Available ports:")
    for i, p in enumerate(ports):
        print(f"{i}: {p}")

    # Directly set requested port
    port_name = "/dev/cu.usbmodem0x80000001"

    print(f"Opening {port_name}...")
    
    try:
        ser = serial.Serial(port_name, 115200, timeout=2)
        
        print("Asserting DTR/RTS...")
        ser.dtr = True
        ser.rts = True
        
        time.sleep(2) # Wait for reboot if DTR triggers it, or just for connection to settle 
        
        # Flush
        ser.reset_input_buffer()
        
        print("\n--- Trying MSP V2 (Serial Config) ---")
        send_msp_v2(ser, MSP2_COMMON_SERIAL_CONFIG)
        
        print("\n--- Trying MSP V1 (Serial Config) ---")
        send_msp_v1(ser, MSP_CF_SERIAL_CONFIG)
        
        ser.close()
        
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
