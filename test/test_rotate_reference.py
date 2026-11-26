"""Independent checks for getbuffer and the bridge commands. Needs Pillow; epdconfig is stubbed.
Run: python3 test/test_rotate_reference.py
"""
import base64, io, os, sys, types

sys.dont_write_bytecode = True
cfg = types.ModuleType("epdconfig")
cfg.RST_PIN = cfg.DC_PIN = cfg.BUSY_PIN = cfg.CS_PIN = 0
for name in ("digital_write", "delay_ms", "spi_writebyte", "spi_writebyte2", "module_exit"):
    setattr(cfg, name, lambda *a, **k: None)
cfg.digital_read = lambda pin: 1
cfg.module_init = lambda *a, **k: 0
sys.modules["epdconfig"] = cfg
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

from PIL import Image  # noqa: E402
from epd import EPD  # noqa: E402
import epd_bridge  # noqa: E402

PALETTE = (0,0,0, 255,255,255, 255,255,0, 255,0,0, 0,0,0, 0,0,255, 0,255,0) + (0,0,0)*249


def reference_1_0_2(image):
    """getbuffer as shipped in 1.0.2, valid sizes only."""
    pal = Image.new("P", (1, 1))
    pal.putpalette(PALETTE)
    if image.size == (600, 400):
        image = image.rotate(90, expand=True)
    raw = image.convert("RGB").quantize(palette=pal).tobytes("raw")
    return [(raw[i] << 4) + raw[i + 1] for i in range(0, len(raw), 2)]


def pixels(buf):
    return [p for b in buf for p in (b >> 4, b & 0x0F)]


def sample(w, h):
    return Image.frombytes("RGB", (w, h), bytes((i * 37) % 256 for i in range(w * h * 3)))


# S1: rotate=0 keeps the 1.0.2 output; rotate=180 is that output turned 180 degrees.
for w, h in ((400, 600), (600, 400)):
    im = sample(w, h)
    up = EPD().getbuffer(im)
    assert up == reference_1_0_2(im), f"{w}x{h}: rotate=0 differs from 1.0.2"
    assert EPD(rotate=0).getbuffer(im) == up
    turned = pixels(EPD(rotate=180).getbuffer(im))
    assert turned != pixels(up) and turned == pixels(up)[::-1], f"{w}x{h}: not a 180 turn"
print("ok rotate 0 == 1.0.2 and 180 == turned, both sizes")


def bridge_with(rotate):
    os.environ["EPD_WRAPPER_ROTATE"] = str(rotate)
    b = epd_bridge.EPDBridge()
    assert b._init()["success"]
    shown = []
    b.epd.display = shown.append
    return b, shown


# S1: every drawing command goes through getbuffer and honours the env var set at spawn.
png = io.BytesIO()
sample(600, 400).save(png, "PNG")
calls = {
    "displayImage": lambda b: b._display_image({"image": base64.b64encode(png.getvalue()).decode()}),
    "drawText": lambda b: b._draw_text({"items": [{"text": "ARRIBA", "x": 10, "y": 10}]}),
    "drawShapes": lambda b: b._draw_shapes({"shapes": [{"type": "rectangle", "coords": [5, 5, 50, 80], "fill": "RED"}]}),
}
for name, call in calls.items():
    (b0, s0), (b180, s180) = bridge_with(0), bridge_with(180)
    assert call(b0)["success"] and call(b180)["success"], name
    assert (b0.epd.rotate, b180.epd.rotate) == (0, 180)
    assert pixels(s180[0]) == pixels(s0[0])[::-1] != pixels(s0[0]), f"{name}: rotate 180 not honoured"
print("ok drawing commands honour EPD_WRAPPER_ROTATE")

# Risk item 5: displayCustom (drawn in Python) == the 1.x path (a PNG of the same colour sent to displayImage).
for color in ((255, 0, 0), (255, 255, 255), (12, 200, 90)):
    b, shown = bridge_with(0)
    assert b._display({"width": 600, "height": 400, "bgColor": "rgb(%d,%d,%d)" % color})["success"]
    solid = io.BytesIO()
    Image.new("RGB", (600, 400), color).save(solid, "PNG")
    assert shown[0] == b.epd.getbuffer(Image.open(io.BytesIO(solid.getvalue()))), color
print("ok displayCustom matches a decoded PNG of the same colour")

# 58d494c: unsupported sizes raise a clear error.
for w, h in ((640, 400), (400, 400), (600, 401)):
    try:
        EPD().getbuffer(Image.new("RGB", (w, h)))
    except ValueError as e:
        assert str(e) == f"Image must be 400x600 or 600x400, got {w}x{h}", e
    else:
        raise AssertionError(f"{w}x{h} accepted")
print("ok unsupported sizes rejected")
os.environ.pop("EPD_WRAPPER_ROTATE", None)
