"""Stand-in for lib/epd_bridge.py: answers every command with the rotation it was spawned with."""
import json
import os
import sys

print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    command = json.loads(line)
    rotate = os.environ.get("EPD_WRAPPER_ROTATE")
    print(json.dumps({"id": command["id"], "success": True, "data": {"rotate": rotate}}), flush=True)
