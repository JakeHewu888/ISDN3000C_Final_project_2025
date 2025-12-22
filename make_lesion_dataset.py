# scripts/make_lesion_dataset.py
from pathlib import Path
import random
import shutil
from typing import Iterable

from PIL import Image

IMG_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".heic", ".heif"}


def copy_to_jpg(src_path: Path, dst_path: Path):
    """转换为 JPG 保存，避免 HEIC/WebP 兼容性问题"""
    try:
        with Image.open(src_path) as im:
            rgb = im.convert("RGB")
            dst_path.parent.mkdir(parents=True, exist_ok=True)
            rgb.save(dst_path, format="JPEG", quality=95)
    except Exception as e:  # noqa: BLE001
        print(f"[warn] skip {src_path}: {e}")


def copy_split(src_root: Path, split: str, out_root: Path, prefix: str):
    """把带框的数据集复制过来，并把所有类重写为 0（单类 lesion）"""
    src_img = src_root / split / "images"
    src_lbl = src_root / split / "labels"
    out_img = out_root / split / "images"
    out_lbl = out_root / split / "labels"
    out_img.mkdir(parents=True, exist_ok=True)
    out_lbl.mkdir(parents=True, exist_ok=True)

    for img_path in src_img.iterdir():
        if img_path.suffix.lower() not in IMG_EXTS:
            continue

        new_img_name = f"{prefix}_{img_path.stem}.jpg"
        new_img_path = out_img / new_img_name
        copy_to_jpg(img_path, new_img_path)

        lab_path = src_lbl / f"{img_path.stem}.txt"
        new_lab_path = out_lbl / f"{prefix}_{img_path.stem}.txt"

        if not lab_path.exists():
            # 有些图可能没框：写空文件也可以
            new_lab_path.write_text("")
            continue

        new_lines = []
        for line in lab_path.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            parts = line.split()
            parts[0] = "0"  # YOLO: class cx cy w h
            new_lines.append(" ".join(parts))
        new_lab_path.write_text("\n".join(new_lines))


def split_healthy(
    healthy_dir: Path,
    out_root: Path,
    ratios=(0.8, 0.1, 0.1),
    seed: int = 42,
):
    """把无标签的健康胳膊图像划分为 train/val/test，并写空标签"""
    assert abs(sum(ratios) - 1.0) < 1e-6, "ratios must sum to 1"
    imgs = [p for p in healthy_dir.iterdir() if p.suffix.lower() in IMG_EXTS]
    random.seed(seed)
    random.shuffle(imgs)
    n = len(imgs)
    n_train = int(n * ratios[0])
    n_val = int(n * ratios[1])

    split_map = {
        "train": imgs[:n_train],
        "valid": imgs[n_train:n_train + n_val],
        "test": imgs[n_train + n_val:],
    }

    for split, paths in split_map.items():
        out_img = out_root / split / "images"
        out_lbl = out_root / split / "labels"
        out_img.mkdir(parents=True, exist_ok=True)
        out_lbl.mkdir(parents=True, exist_ok=True)

        for i, img_path in enumerate(paths):
            new_img_name = f"healthy_{img_path.stem}_{i}.jpg"
            new_img_path = out_img / new_img_name
            copy_to_jpg(img_path, new_img_path)
            (out_lbl / f"healthy_{img_path.stem}_{i}.txt").write_text("")

    print(f"[healthy] total={n}, train={len(split_map['train'])}, "
          f"val={len(split_map['valid'])}, test={len(split_map['test'])}")


def main():
    project_root = Path(".")
    skin = project_root / "datasets" / "raw" / "skin_cancer"
    eczema = project_root / "datasets" / "raw" / "eczema"
    healthy = project_root / "datasets" / "raw" / "healthy_arm" / "images"
    out = project_root / "datasets" / "lesion_det"

    for split in ["train", "valid", "test"]:
        copy_split(skin, split, out, prefix="skin")
        copy_split(eczema, split, out, prefix="eczema")

    split_healthy(healthy, out, ratios=(0.8, 0.1, 0.1), seed=42)

    (out / "data.yaml").write_text(
        "train: train/images\n"
        "val: valid/images\n"
        "test: test/images\n\n"
        "nc: 1\n"
        "names: ['lesion']\n"
    )
    print("Done! dataset saved to datasets/lesion_det")

if __name__ == "__main__":
    main()
