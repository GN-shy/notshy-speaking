# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

root = Path(SPECPATH)
a = Analysis(
    [str(root / 'desktop_app.py')],
    pathex=[str(root)],
    binaries=[],
    datas=[
        (str(root / 'web'), 'web'),
        (str(root / 'data' / 'question-bank.json'), 'data'),
        (str(root / 'packaging' / 'NotShy.ico'), 'packaging'),
    ],
    hiddenimports=['pystray._win32'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'numpy', 'pandas', 'scipy', 'matplotlib', 'PyQt5', 'PyQt6', 'PySide6'],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, a.binaries, a.datas, [],
    name='NotShy', debug=False, bootloader_ignore_signals=False,
    strip=False, upx=False, console=False,
    icon=str(root / 'packaging' / 'NotShy.ico'),
    version=str(root / 'packaging' / 'version_info.txt'),
)
