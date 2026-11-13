"""Copy the recognition engine out of an installed homr into web/public.

    python tools/pack_assets.py        (run with a Python that has `pip install homr`
                                        and has run `homr --init` once)
Writes public/homr.zip (Python sources) and public/models/{segnet,encoder,decoder}.onnx.
"""
import pathlib
import shutil
import zipfile

import homr

src = pathlib.Path(homr.__file__).parent
public = pathlib.Path(__file__).parent.parent / "public"
(public / "models").mkdir(parents=True, exist_ok=True)

with zipfile.ZipFile(public / "homr.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for f in src.rglob("*"):
        if f.is_file() and f.suffix != ".onnx" and "__pycache__" not in f.parts:
            z.write(f, pathlib.Path("homr") / f.relative_to(src))

for name in ("segnet", "encoder", "decoder"):
    (model,) = [f for f in src.rglob(f"{name}*.onnx") if "fp16" not in f.name]
    shutil.copyfile(model, public / "models" / f"{name}.onnx")
    print(name, model.name)
