#!/usr/bin/env python
#************************************************************
# Copyright (c) MLRS project
# GPL3
# https://www.gnu.org/licenses/gpl-3.0.de.html
# OlliW @ www.olliw.eu
#************************************************************
# check serial ports
# 20. Apr. 2025


try:
    from serial.tools.list_ports import comports
    portList = list(comports())
except:
    print('serial.tools.list_ports')

for port in portList:
    print('*',port.device)
    print('  ',port.name)
    print('  ',port.description)
    print('  ',port.hwid)
    print('  ',port.vid, port.pid)
    print('  ',port.serial_number)
    print('  ',port.location)
    print('  ',port.manufacturer)
    print('  ',port.product)
    print('  ',port.interface)
    

print('Press Enter to finish')
input()
