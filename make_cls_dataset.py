from pathlib import Path
import cv2
import random

IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

def clamp(v, lo, hi):
    return max(lo, min(hi, v))

def yolo_line_to_xyxy(line, img_w, img_h):
    parts = line.strip().split()
    cls = int(parts[0])
    cx, cy, w, h = map(float, parts[1:5])
    x1 = (cx - w / 2) * img_w
    y1 = (cy - h / 2) * img_h
    x2 = (cx + w / 2) * img_w
    y2 = (cy + h / 2) * img_h
    return cls, x1, y1, x2, y2

def save_crop(img, xyxy, out_path, pad_ratio=0.15, min_size=20):
    h, w = img.shape[:2]
    x1, y1, x2, y2 = xyxy
    bw, bh = x2 - x1, y2 - y1
    if bw <= 0 or bh <= 0:
        return False

    pad_x, pad_y = bw * pad_ratio, bh * pad_ratio
    x1 = clamp(int(x1 - pad_x), 0, w - 1)
    y1 = clamp(int(y1 - pad_y), 0, h - 1)
    x2 = clamp(int(x2 + pad_x), 0, w - 1)
    y2 = clamp(int(y2 + pad_y), 0, h - 1)

    roi = img[y1:y2, x1:x2]
    if roi.size == 0:
        return False
    rh, rw = roi.shape[:2]
    if rh < min_size or rw < min_size:
        return False

    out_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_path), roi)
    return True

def export_rois(
    yolo_root: Path,
    split: str,              # "train" or "valid"
    out_root: Path,          # "cls_dataset"
    out_split: str,          # "train" or "val"
    keep_classes: set,       # e.g. {1}
    target_label: str,       # "cancer"/"eczema"/"unknown"
    limit_images: int | None = None,
):
    img_dir = yolo_root / split / "images"
    lab_dir = yolo_root / split / "labels"

    images = [p for p in img_dir.iterdir() if p.suffix.lower() in IMG_EXTS]
    images.sort()
    if limit_images:
        images = images[:limit_images]

    saved = 0
    for img_path in images:
        lab_path = lab_dir / (img_path.stem + ".txt")
        if not lab_path.exists():
            continue

        img = cv2.imread(str(img_path))
        if img is None:
            continue
        h, w = img.shape[:2]

        lines = [ln for ln in lab_path.read_text().splitlines() if ln.strip()]
        for i, ln in enumerate(lines):
            cls, x1, y1, x2, y2 = yolo_line_to_xyxy(ln, w, h)
            if cls not in keep_classes:
                continue

            out_path = out_root / out_split / target_label / f"{img_path.stem}_{i}.jpg"
            if save_crop(img, (x1, y1, x2, y2), out_path):
                saved += 1

    print(f"[{yolo_root.name}/{split}] -> {out_root}/{out_split}/{target_label}: saved {saved} crops")

def main():
    project_root = Path(".")
    # 使用 raw 数据根，包含原始标注
    skin = project_root / "datasets" / "raw" / "skin_cancer"
    eczema = project_root / "datasets" / "raw" / "eczema"
    out_root = project_root / "datasets" / "lesion_cls"

    # 1) cancer: skin_cancer class=1
    export_rois(skin, "train", out_root, "train", keep_classes={1}, target_label="cancer")
    export_rois(skin, "valid", out_root, "val",   keep_classes={1}, target_label="cancer")
    export_rois(skin, "test",  out_root, "test",  keep_classes={1}, target_label="cancer")

    # 2) unknown: 先用 skin_cancer 的 benign class=0 当 unknown（先跑通）
    export_rois(skin, "train", out_root, "train", keep_classes={0}, target_label="unknown")
    export_rois(skin, "valid", out_root, "val",   keep_classes={0}, target_label="unknown")
    export_rois(skin, "test",  out_root, "test",  keep_classes={0}, target_label="unknown")

    # 3) eczema: eczema 数据集只有 class=0
    export_rois(eczema, "train", out_root, "train", keep_classes={0}, target_label="eczema")
    export_rois(eczema, "valid", out_root, "val",   keep_classes={0}, target_label="eczema")
    export_rois(eczema, "test",  out_root, "test",  keep_classes={0}, target_label="eczema")

    print("Done. Check cls_dataset/")

if __name__ == "__main__":
    main()
