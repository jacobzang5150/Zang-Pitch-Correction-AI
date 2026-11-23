"""Build the portable editor. With --mac, package the offline macOS bundle."""
import argparse
from pathlib import Path
import plistlib
import tempfile
import zipfile

root = Path(__file__).resolve().parents[1]
src = root / "src"
name = "Zang-Pitch-Correction-AI"
engine = "\n".join((src / f).read_text() for f in ["boundary-model.js", "analysis.js", "harmony.js", "render.js"])
ui = "\n".join((src / f).read_text() for f in ["files.js", "app.js", "monitor.js", "toolbox.js", "timeline.js"])
html = (src / "editor.html").read_text().replace("/* STYLE */", (src / "style.css").read_text())
html = html.replace("/* ENGINE */", engine).replace("/* APP */", engine + "\n" + ui)
editor = root / (name + ".html")
editor.write_text(html)
parser = argparse.ArgumentParser()
parser.add_argument("--mac", action="store_true")
if parser.parse_args().mac:
    with tempfile.TemporaryDirectory() as tmp:
        build = Path(tmp)
        contents = build / "Zang Pitch Correction AI.app" / "Contents"
        resources = contents / "Resources"
        binary = contents / "MacOS" / "ZangPitch"
        resources.mkdir(parents=True)
        binary.parent.mkdir()
        (resources / editor.name).write_bytes(editor.read_bytes())
        info = dict(CFBundleExecutable="ZangPitch",CFBundleIdentifier="music.zang.pitchcorrection.beta",
                    CFBundleName="Zang Pitch Correction AI",CFBundlePackageType="APPL",CFBundleVersion="3",
                    CFBundleShortVersionString="0.3.0",LSMinimumSystemVersion="12.0",
                    CFBundleInfoDictionaryVersion="6.0",NSHighResolutionCapable=True)
        (contents/"Info.plist").write_bytes(plistlib.dumps(info))
        binary.write_bytes((root/"mac"/"ZangPitch").read_bytes())
        binary.chmod(0o755)
        out = root/"dist"
        out.mkdir(exist_ok=True)
        with zipfile.ZipFile(out/(name+"-Mac-Beta.zip"),"w",zipfile.ZIP_DEFLATED) as archive:
            for file in sorted(contents.rglob("*")):
                if file.is_file(): archive.write(file,file.relative_to(build))
            archive.write(editor, editor.name)
            archive.write(root/"README.md","README.md")
