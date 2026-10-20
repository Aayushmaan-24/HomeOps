"""Local object detection (YOLO) for camera frames. Runs in venv-agent."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional

MODEL_NAME = os.getenv("YOLO_MODEL", "yolov8n.pt")
CARRIED = {"backpack", "handbag", "suitcase"}  # package-like objects in COCO
_MODEL = None


def _model():
    global _MODEL
    if _MODEL is None:
        from ultralytics import YOLO

        _MODEL = YOLO(MODEL_NAME)  # downloads weights (~6 MB) on first use
    return _MODEL


def detect(image_path: str, out_path: Optional[str] = None, conf: float = 0.35) -> Dict[str, Any]:
    """Run detection on one image. Optionally save an annotated copy."""
    res = _model()(str(image_path), conf=conf, verbose=False)[0]
    items = [
        {
            "label": res.names[int(b.cls)],
            "confidence": round(float(b.conf), 2),
            "box": [round(float(v)) for v in b.xyxy[0].tolist()],
        }
        for b in res.boxes
    ]
    if out_path:
        import cv2

        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(out_path), res.plot())
    return {
        "people": sum(1 for i in items if i["label"] == "person"),
        "objects": sorted({i["label"] for i in items}),
        "carrying": any(i["label"] in CARRIED for i in items),
        "items": items,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: python -m homeops.perception <image> [annotated_out.jpg]")
        sys.exit(1)
    out = sys.argv[2] if len(sys.argv) > 2 else "console/public/frames/test.jpg"
    print(json.dumps(detect(sys.argv[1], out), indent=2))
