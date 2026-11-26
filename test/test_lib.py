"""Checks for lib/epd.py getbuffer and the bridge's display command.

No hardware needed: epdconfig (SPI/GPIO) is stubbed. Needs Pillow.
Run: python3 test/test_lib.py
"""
import os
import sys
import types

sys.dont_write_bytecode = True  # keep lib/ free of __pycache__

epdconfig = types.ModuleType("epdconfig")  # the real one needs spidev/gpiozero
epdconfig.RST_PIN = epdconfig.DC_PIN = epdconfig.BUSY_PIN = epdconfig.CS_PIN = 0
sys.modules["epdconfig"] = epdconfig
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

from PIL import Image  # noqa: E402
from epd import EPD  # noqa: E402


def pixels(buf):
    """Unpack the 2-pixels-per-byte panel buffer into one colour index per pixel."""
    return [p for byte in buf for p in (byte >> 4, byte & 0x0F)]


for width, height in ((400, 600), (600, 400)):
    # Asymmetric, non-palette content so a missing or wrong turn cannot pass.
    data = bytes((i * 37) % 256 for i in range(width * height * 3))
    image = Image.frombytes("RGB", (width, height), data)

    upright = pixels(EPD().getbuffer(image))
    turned = pixels(EPD(rotate=180).getbuffer(image))

    assert turned != upright, f"{width}x{height}: rotate=180 changed nothing"
    assert turned == upright[::-1], f"{width}x{height}: rotate=180 is not a 180-degree turn"
    print(f"ok rotate 180 on {width}x{height}")

# Any other size is rejected with a clear message.
try:
    EPD().getbuffer(Image.new("RGB", (640, 400)))
except ValueError as e:
    assert str(e) == "Image must be 400x600 or 600x400, got 640x400", e
else:
    raise AssertionError("a 640x400 image was accepted")
print("ok 640x400 rejected")

# The bridge's "display" command (used by displayCustom) fills the panel with one colour.
import epd_bridge  # noqa: E402

bridge = epd_bridge.EPDBridge()
bridge.epd, bridge.initialized = EPD(), True
shown = []
bridge.epd.display = shown.append  # capture the buffer instead of sending it over SPI
result = bridge._display({"width": 600, "height": 400, "bgColor": "rgb(255,0,0)"})
assert result == {"success": True}, result
assert set(pixels(shown[0])) == {3}, "display rgb(255,0,0) is not solid red (palette index 3)"
print("ok display rgb(255,0,0) is solid red")
