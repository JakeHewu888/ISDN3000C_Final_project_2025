import cv2
import os
import time

print("=== USB Camera Test Tool ===")

# Try common device indexes
# USB cameras usually appear as 0 or 1.
# RDK systems might have internal video devices occupying 0-7.
indexes_to_try = [0, 1, 2, 8, 10]

success = False

for idx in indexes_to_try:
    print(f"\n[Testing] Trying /dev/video{idx} ...")
    
    cap = cv2.VideoCapture(idx)
    
    # Try to enforce resolution (helpful for some USB cams)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    
    if not cap.isOpened():
        print(f"  -> Failed to open device {idx}")
        continue
    
    # Try to read a frame
    print(f"  -> Device opened. Reading frames...")
    
    # Read a few frames to clear buffer/auto-exposure
    for i in range(5):
        ret, frame = cap.read()
        if not ret:
            break
        time.sleep(0.1)
        
    ret, frame = cap.read()
    cap.release()
    
    if ret and frame is not None:
        filename = f"test_cam_{idx}.jpg"
        cv2.imwrite(filename, frame)
        print(f"  -> SUCCESS! Image saved to '{filename}'")
        print(f"  -> Resolution: {frame.shape[1]}x{frame.shape[0]}")
        success = True
        break # Found one working camera, stop
    else:
        print(f"  -> Failed to read frame from device {idx}")

if not success:
    print("\n[ERROR] No working USB camera found.")
    print("Suggestions:")
    print("1. Check USB connection.")
    print("2. Run 'ls -l /dev/video*' in terminal to see devices.")
else:
    print("\n[DONE] Camera test passed.")

