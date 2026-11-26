"""Stand-in for lib/epd_bridge.py: answers every command with the rotation it was spawned with."""
import json
import os
import signal
import sys

# Like epd_bridge.py: SIGTERM alone does not end the stdin loop, only EOF does.
signal.signal(signal.SIGTERM, lambda *_: None)

print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    command = json.loads(line)
    rotate = os.environ.get("EPD_WRAPPER_ROTATE")
    print(json.dumps({"id": command["id"], "success": True, "data": {"rotate": rotate}}), flush=True)
