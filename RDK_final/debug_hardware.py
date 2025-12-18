import time
import sys

print("=== Hardware Diagnostic Tool ===")

try:
    import Hobot.GPIO as GPIO
    print("[OK] Hobot.GPIO imported")
    print(f"GPIO Attributes: {[x for x in dir(GPIO) if not x.startswith('_')]}")
except ImportError:
    print("[FAIL] Hobot.GPIO not found")
    try:
        import RPi.GPIO as GPIO
        print("[OK] RPi.GPIO imported")
    except:
        print("[FAIL] No GPIO library found")
        sys.exit(1)

BTN1 = 17
BTN2 = 27

GPIO.setwarnings(False)
GPIO.setmode(GPIO.BCM)

# Try setup
print("\n[INFO] Setting up Pin 17 & 27 as INPUT...")
try:
    if hasattr(GPIO, 'PUD_UP'):
        print(f"Using PUD_UP={GPIO.PUD_UP}")
        GPIO.setup(BTN1, GPIO.IN, pull_up_down=GPIO.PUD_UP)
        GPIO.setup(BTN2, GPIO.IN, pull_up_down=GPIO.PUD_UP)
    else:
        print("WARN: No PUD_UP found. Pins might float!")
        GPIO.setup(BTN1, GPIO.IN)
        GPIO.setup(BTN2, GPIO.IN)
except Exception as e:
    print(f"[FAIL] GPIO Setup error: {e}")

print("\n[TEST] Reading Pins (Press Ctrl+C to stop)...")
print("Press your buttons now. If values fluctuate without pressing, you need Pull-Up Resistors.")

try:
    while True:
        b1 = GPIO.input(BTN1)
        b2 = GPIO.input(BTN2)
        print(f"Pin 17: {b1} | Pin 27: {b2}", end='\r')
        time.sleep(0.1)
except KeyboardInterrupt:
    print("\n[Done]")
    GPIO.cleanup()

