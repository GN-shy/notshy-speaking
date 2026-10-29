"""Build an allowlisted, clean Windows distribution without personal data."""
import hashlib
from importlib import metadata
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERSION = '1.3.2'


def main():
    env = os.environ.copy()
    env['PYINSTALLER_CONFIG_DIR'] = str(ROOT / 'build' / 'pyinstaller-cache')
    subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean',
                    '--distpath', str(ROOT / 'dist'), '--workpath', str(ROOT / 'build' / 'pyinstaller'),
                    str(ROOT / 'NotShy.spec')], cwd=ROOT, env=env, check=True)
    package = ROOT / 'release' / 'NotShy'
    licenses = package / 'THIRD_PARTY_LICENSES'
    licenses.mkdir(parents=True, exist_ok=True)
    allowed = []

    def copy(source, target):
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
        allowed.append(target)

    copy(ROOT / 'dist' / 'NotShy.exe', package / 'NotShy.exe')
    copy(ROOT / 'packaging' / '使用说明.txt', package / '使用说明.txt')
    python_license = Path(sys.base_prefix) / 'LICENSE.txt'
    if not python_license.exists():
        raise FileNotFoundError('Python LICENSE.txt is required for redistribution')
    copy(python_license, licenses / 'Python-LICENSE.txt')
    versions = {}
    for name in ('PyInstaller', 'pystray', 'Pillow', 'six'):
        dist = metadata.distribution(name)
        versions[name] = dist.version
        found = []
        for entry in dist.files or []:
            lower = entry.name.lower()
            if any(word in lower for word in ('license', 'copying', 'copyright')) and not lower.endswith(('.py', '.pyc')):
                path = Path(dist.locate_file(entry))
                if path.is_file():
                    found.append(path)
        if not found:
            raise FileNotFoundError(f'Missing license for {name}')
        for i, source in enumerate(found):
            copy(source, licenses / name / f'{i + 1}-{source.name}')
    notice = package / 'THIRD_PARTY_NOTICES.txt'
    notice.write_text('NotShy bundles the Python runtime and these components:\n' +
                      '\n'.join(f'{name} {version}' for name, version in versions.items()) +
                      '\n\nTheir license texts are in THIRD_PARTY_LICENSES.\n'
                      'PyInstaller includes a bootloader exception permitting application distribution.\n'
                      'Windows, Microsoft Edge and Windows speech voices are supplied by the operating system.\n',
                      encoding='utf-8')
    allowed.append(notice)
    info = package / 'BUILDINFO.json'
    info.write_text(json.dumps({'product': 'NotShy', 'version': VERSION, 'architecture': 'Windows-x64',
                               'python': sys.version.split()[0], 'components': versions,
                               'personal_data_included': False}, indent=2), encoding='utf-8')
    allowed.append(info)
    checks = package / '文件校验.txt'
    checks.write_text('\n'.join(hashlib.sha256(path.read_bytes()).hexdigest() + '  ' + path.relative_to(package).as_posix()
                                 for path in sorted(allowed)) + '\n', encoding='utf-8')
    allowed.append(checks)
    archive = ROOT / 'release' / f'NotShy-{VERSION}-Windows-x64.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as output:
        for path in sorted(allowed):
            output.write(path, 'NotShy/' + path.relative_to(package).as_posix())
    with zipfile.ZipFile(archive) as output:
        assert output.testzip() is None
        assert not any('notshydata/' in name.lower() or 'recordings/' in name.lower() or name.endswith('.sqlite3') for name in output.namelist())
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (archive.with_suffix('.zip.sha256')).write_text(f'{digest}  {archive.name}\n', encoding='ascii')
    print(json.dumps({'archive': str(archive), 'files': len(allowed), 'bytes': archive.stat().st_size,
                      'sha256': digest, 'exe_sha256': hashlib.sha256((package / 'NotShy.exe').read_bytes()).hexdigest()}, indent=2))


if __name__ == '__main__':
    main()
