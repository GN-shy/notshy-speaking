"""Windows executable entry point; runtime and web assets are bundled by PyInstaller."""
import os
from pathlib import Path
import sys
import traceback


def start_tray(server, open_window):
    import threading
    import pystray
    from PIL import Image
    icon_path = Path(__file__).resolve().parent / 'packaging' / 'NotShy.ico'
    tray = pystray.Icon('NotShy', Image.open(icon_path), 'NotShy · 不 Shy 口语', menu=pystray.Menu(
        pystray.MenuItem('打开 NotShy', lambda icon, item: open_window(), default=True),
        pystray.MenuItem('退出 NotShy', lambda icon, item: threading.Thread(target=server.shutdown, daemon=True).start()),
    ))
    tray.run_detached()
    return tray


def main():
    try:
        from server import main as serve
        serve()
    except Exception:
        detail = traceback.format_exc()
        if not getattr(sys, 'frozen', False):
            raise
        folder = Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'NotShy'
        folder.mkdir(parents=True, exist_ok=True)
        (folder / 'startup-error.log').write_text(detail, encoding='utf-8')
        import ctypes
        ctypes.windll.user32.MessageBoxW(None,
            f'启动失败。请将下面的日志交给开发者：\n{folder / "startup-error.log"}\n\n{detail.splitlines()[-1]}',
            'NotShy', 0x10)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
