"""Make "phone photo" and "office scan" versions of clean page images.

    python bench/degrade.py            reads ~/.omrbench/pages/<score>/pN.png,
                                       writes pages_photo/ and pages_scan/ beside it

photo: paper on a desk shot at an angle - perspective, rotation, uneven light with a
       shadow, soft focus, sensor noise, JPEG artefacts.
scan:  flatbed/copier - slightly crooked, 150 dpi grey, noise, harsh contrast.
Seeded per page, so runs are repeatable.
"""
import pathlib
import zlib

import cv2
import numpy as np

BENCH = pathlib.Path.home() / ".omrbench"


def jpeg(img, quality):
    return cv2.imdecode(cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])[1], cv2.IMREAD_COLOR)


def photo(img, rng):
    h, w = img.shape[:2]
    pad = int(0.06 * w)
    desk = np.full((h + 2 * pad, w + 2 * pad, 3), (96, 112, 128), np.uint8)  # wooden desk, BGR
    desk[pad : pad + h, pad : pad + w] = img
    H, W = desk.shape[:2]
    corners = np.float32([[0, 0], [W, 0], [W, H], [0, H]])
    moved = (corners + rng.uniform(-0.035, 0.035, (4, 2)) * [W, H]).astype(np.float32)
    out = cv2.warpPerspective(desk, cv2.getPerspectiveTransform(corners, moved), (W, H), borderValue=(96, 112, 128))
    turn = cv2.getRotationMatrix2D((W / 2, H / 2), rng.uniform(-3, 3), 0.97)
    out = cv2.warpAffine(out, turn, (W, H), borderValue=(96, 112, 128))
    # Light falls off towards one corner, and a soft shadow crosses the page.
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    angle = rng.uniform(0, 2 * np.pi)
    ramp = ((xx / W - 0.5) * np.cos(angle) + (yy / H - 0.5) * np.sin(angle)) * 0.5 + 0.8
    cx, cy = rng.uniform(0.2, 0.8) * W, rng.uniform(0.2, 0.8) * H
    shadow = 1 - 0.25 * np.exp(-(((xx - cx) / (0.35 * W)) ** 2 + ((yy - cy) / (0.2 * H)) ** 2))
    out = out.astype(np.float32) * (ramp * shadow)[..., None]
    out = cv2.GaussianBlur(out, (0, 0), 1.1) + rng.normal(0, 5, out.shape)
    return jpeg(np.clip(out, 0, 255).astype(np.uint8), 62)


def scan(img, rng):
    h, w = img.shape[:2]
    out = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    turn = cv2.getRotationMatrix2D((w / 2, h / 2), rng.uniform(-1.5, 1.5), 1)
    out = cv2.warpAffine(out, turn, (w, h), borderValue=255)
    out = cv2.resize(out, None, fx=0.75, fy=0.75, interpolation=cv2.INTER_AREA)  # 200 -> 150 dpi
    out = cv2.GaussianBlur(out, (0, 0), 0.6).astype(np.float32) + rng.normal(0, 8, out.shape)
    out = np.clip((out - 128) * 1.6 + 128, 0, 255).astype(np.uint8)  # copier contrast
    return jpeg(cv2.cvtColor(out, cv2.COLOR_GRAY2BGR), 70)


if __name__ == "__main__":
    for page in sorted((BENCH / "pages").glob("*/p*.png")):
        img = cv2.imread(str(page))
        for name, make in (("photo", photo), ("scan", scan)):
            rng = np.random.default_rng(zlib.crc32(f"{name}/{page.parent.name}/{page.name}".encode()))
            out = BENCH / f"pages_{name}" / page.parent.name / page.name
            out.parent.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(out), make(img, rng))
    print("done")
