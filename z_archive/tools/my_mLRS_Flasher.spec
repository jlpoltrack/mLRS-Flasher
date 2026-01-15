# -*- mode: python ; coding: utf-8 -*-


appname = 'mLRS_Flasher'
path = '../'

print('------------------------------------------------\n')
print(' pyinstaller builds '+appname+'\n')
print('------------------------------------------------')


block_cipher = None


a = Analysis(
    [path + appname+'.py'],
    pathex=[],
    binaries=[],
    datas=[
        (path + 'assets' , 'assets'),
        (path + 'thirdparty/esptool' , 'thirdparty/esptool'),
        (path + 'thirdparty/mavlink' , 'thirdparty/mavlink'),
        (path + appname+'.py' , '.'),
        (path + 'edgetxInitPassthru.py' , '.'),
        (path + 'apInitPassthru.py' , '.'),
        (path + 'thirdparty/STM32CubeProgrammer/win' , 'thirdparty/STM32CubeProgrammer/win'),
        # https://github.com/TomSchimansky/CustomTkinter/wiki/Packaging
        ('c:\winpython3-10-5\wpy64-31050\python-3.10.5.amd64\lib\site-packages\customtkinter' , 'customtkinter'),
        ],
   hiddenimports=[
        'pyserial', # it seems pyinstaller cannot handle the fact that the module is pyserial but the import is serial
        ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'bcrypt',
        #'certifi', #is required
        'cryptography',
        'docutils',
        'numpy',
        'markupsafe',
        'scipy',
        'matplotlib'
        ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name=appname,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True, # using False would be nice and possible, but we then need to improve the calling of external programs a bit more
    #console=False,
    icon = path + 'assets/mLRS_logo_round.ico', # doesn't work for some reason
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name=appname,
)


print('------------------------------------------------\n')
print(' pyinstaller done with building '+appname+'\n')
print('------------------------------------------------')

