# -*- mode: python ; coding: utf-8 -*-
# PyInstaller 打包配置 —— 財閥 对局助手
# 用法：  pyinstaller app.spec
# 产物：  dist/财阀对局助手.exe （单文件，双击即用）

block_cipher = None

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    # 关键：把整个 app/ 目录作为数据一起打进 exe
    datas=[('app', 'app')],
    hiddenimports=['webview'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='财阀对局助手',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,          # 窗口程序，不弹黑色命令行
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='app_icon.ico',    # 若没有图标文件，删除此行或换成自己的 .ico
)
