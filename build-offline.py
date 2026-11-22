from pathlib import Path
import hashlib, json, shutil, zipfile
root = Path(__file__).resolve().parent
version = json.loads((root / 'package.json').read_text(encoding='utf-8'))['version']
out = root / f'offline-{version}'
dist = root / 'dist'
if out.exists():
    raise RuntimeError('Refuse overwrite of existing offline artifact; review before rebuilding')
out.mkdir()
dist.mkdir(exist_ok=True)
files = ['index.html', 'app.js', 'styles.css', 'parsers.js', 'package.json', 'vendor/3Dmol-min.js', 'vendor/3Dmol-LICENSE.txt']
manifest = {}
for name in files:
    src, dst = root / 'public' / name, out / name
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, dst)
    manifest[name] = hashlib.sha256(dst.read_bytes()).hexdigest()
shutil.copyfile(root / 'docs/README.md', out / '使用说明.md')
shutil.copyfile(root / 'docs/AGENT-INTEGRATION.md', out / 'AGENT-INTEGRATION.md')
shutil.copyfile(root / 'THIRD_PARTY_NOTICES.md', out / 'THIRD_PARTY_NOTICES.md')
shutil.copyfile(root / 'LICENSE', out / 'LICENSE')
archive = dist / f'分子三维查看器_离线版_{version}.zip'
with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED) as z:
    for path in out.rglob('*'):
        if path.is_file(): z.write(path, path.relative_to(out).as_posix())
print(json.dumps({'archive': str(archive), 'bytes': archive.stat().st_size, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'assets': manifest}, ensure_ascii=False))
