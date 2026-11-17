"""Make print-ready QR codes (SVG) for the BGI cards and the entrance sign.

    pip install qrcode
    python make_qr.py https://YOUR-NAME.github.io/bgi-garden/ pratt-library cafe-kent bookstore

One code per handout spot (?src=...), plus the entrance code (?at=gate).
Ink is the riso dark green; print on the yellow block from the card design.
"""
import sys
import qrcode
import qrcode.image.svg

INK = "#1F3D30"


def make(url, path):
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=2, box_size=10)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(image_factory=qrcode.image.svg.SvgPathImage)
    svg = img.to_string(encoding="unicode").replace('fill="#000000"', f'fill="{INK}"')
    with open(path, "w") as f:
        f.write(svg)
    print(path, "→", url)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    base = sys.argv[1].rstrip("/") + "/"
    make(base + "?at=gate", "qr/gate.svg")
    for src in sys.argv[2:] or ["general"]:
        make(base + "?src=" + src, f"qr/card-{src}.svg")
