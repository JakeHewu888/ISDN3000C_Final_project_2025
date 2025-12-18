import time
import threading
import cv2
import os
import shutil

# GPIO Setup
try:
    import Hobot.GPIO as GPIO
    print("[Hardware] Using Hobot.GPIO")
except ImportError:
    try:
        import RPi.GPIO as GPIO
        print("[Hardware] Using RPi.GPIO")
    except ImportError:
        class MockGPIO:
            BCM='BCM';IN='IN';OUT='OUT';PUD_UP=22;HIGH=1;LOW=0
            def setmode(self,m):pass
            def setup(self,p,m,pull_up_down=None):pass
            def output(self,p,s):pass
            def input(self,p):return 1 
            def cleanup(self):pass
            def setwarnings(self,s):pass
        GPIO = MockGPIO()

class HardwareManager:
    def __init__(self, inference_engine=None, capture_dir='UI/captures'):
        self.BTN1_PIN = 17
        self.BTN2_PIN = 27
        self.LED1_PIN = 22
        self.LED2_PIN = 23
        
        self.inference_engine = inference_engine
        self.capture_dir = capture_dir
        if not os.path.exists(capture_dir):
            os.makedirs(capture_dir)

        # Global State
        self.state = {
            'mode': 1,
            'last_image_url': None,
            'last_image_ts': 0,
            'analysis_result': None,
            'is_processing': False,
            'session_active': False
        }
        
        self.running = False
        self.lock = threading.Lock()
        self.cap = None

        # Init GPIO
        try:
            GPIO.setwarnings(False); GPIO.setmode(GPIO.BCM)
            pud = GPIO.PUD_UP if hasattr(GPIO, 'PUD_UP') else None
            if pud:
                GPIO.setup(self.BTN1_PIN, GPIO.IN, pull_up_down=pud)
                GPIO.setup(self.BTN2_PIN, GPIO.IN, pull_up_down=pud)
            else:
                GPIO.setup(self.BTN1_PIN, GPIO.IN)
                GPIO.setup(self.BTN2_PIN, GPIO.IN)
            GPIO.setup(self.LED1_PIN, GPIO.OUT); GPIO.setup(self.LED2_PIN, GPIO.OUT)
            self._update_leds()
        except Exception as e:
            print(f"[Hardware] GPIO Init Error: {e}")

        self._init_camera()

    def _init_camera(self):
        if self.cap:
            try: self.cap.release()
            except: pass
        
        print("[Camera] Initializing...")
        for idx in [0, 1, 8, 10]:
            cap = cv2.VideoCapture(idx)
            if cap.isOpened():
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
                ret, _ = cap.read()
                if ret:
                    self.cap = cap
                    print(f"[Camera] Opened device {idx}")
                    return
                cap.release()
        print("[Camera] No working camera found.")

    def reset_session(self):
        with self.lock:
            self.state['last_image_url'] = None
            self.state['last_image_ts'] = 0
            self.state['analysis_result'] = None
            self.state['is_processing'] = False
            self.state['session_active'] = True

    def inject_image(self, filepath):
        """Allows external source (like file upload) to process an image"""
        print(f"[Inject] Processing external image: {filepath}")
        
        # Ensure it's in our capture dir (app.py puts it there, but relative path needed for UI)
        filename = os.path.basename(filepath)
        
        with self.lock:
            self.state['last_image_url'] = f"captures/{filename}"
            self.state['last_image_ts'] = int(time.time())
            self.state['is_processing'] = False
            self.state['analysis_result'] = None

        self._trigger_ai_if_needed(filepath, filename)

    def _trigger_ai_if_needed(self, filepath, filename):
        if self.state['mode'] == 2 and self.inference_engine:
            print("[AI] Analyzing...")
            with self.lock: self.state['is_processing'] = True
            
            def run_ai():
                try:
                    res = self.inference_engine.run_inference(filepath)
                    if 'annotatedPath' in res:
                        fname = os.path.basename(res['annotatedPath'])
                        res['annotatedUrl'] = f"captures/{fname}"
                        
                    with self.lock:
                        self.state['analysis_result'] = res
                        self.state['is_processing'] = False
                    print("[AI] Done.")
                except Exception as e:
                    print(f"[AI] Error: {e}")
                    with self.lock: self.state['is_processing'] = False

            threading.Thread(target=run_ai).start()

    def _update_leds(self):
        try:
            if self.state['mode'] == 1:
                GPIO.output(self.LED1_PIN, GPIO.HIGH)
                GPIO.output(self.LED2_PIN, GPIO.LOW)
            else:
                GPIO.output(self.LED1_PIN, GPIO.LOW)
                GPIO.output(self.LED2_PIN, GPIO.HIGH)
        except: pass

    def start(self):
        self.running = True
        t = threading.Thread(target=self._loop)
        t.daemon = True
        t.start()

    def stop(self):
        self.running = False
        if self.cap: self.cap.release()
        try: GPIO.cleanup()
        except: pass

    def _loop(self):
        print("[Hardware] Loop started")
        last_btn1 = 0; last_btn2 = 0; debounce = 1.0

        while self.running:
            try:
                b1 = GPIO.input(self.BTN1_PIN)
                b2 = GPIO.input(self.BTN2_PIN)
                now = time.time()

                if b1 == 0 and (now - last_btn1) > debounce:
                    last_btn1 = now
                    print("[Hardware] Button 1 Pressed")
                    self._handle_capture()

                if b2 == 0 and (now - last_btn2) > debounce:
                    last_btn2 = now
                    with self.lock:
                        self.state['mode'] = 3 - self.state['mode']
                        self._update_leds()
                        self.state['analysis_result'] = None 
                        print(f"[Hardware] Mode -> {self.state['mode']}")

                time.sleep(0.05)
            except Exception as e:
                print(f"[Hardware] Loop Error: {e}")
                time.sleep(1)

    def _flush_buffer(self):
        for _ in range(5):
            self.cap.grab()
        return self.cap.read()

    def _handle_capture(self):
        if not self.cap or not self.cap.isOpened():
            self._init_camera()
        
        if not self.cap: return

        ret, frame = self._flush_buffer()
        if not ret:
            print("[Camera] Retry...")
            self._init_camera()
            if self.cap: ret, frame = self._flush_buffer()
        
        if not ret or frame is None:
            print("[Camera] Failed.")
            return

        ts = int(time.time())
        filename = f"capture_{ts}.jpg"
        filepath = os.path.join(self.capture_dir, filename)
        cv2.imwrite(filepath, frame)
        print(f"[Camera] Saved {filepath}")

        with self.lock:
            self.state['last_image_url'] = f"captures/{filename}"
            self.state['last_image_ts'] = ts
            self.state['is_processing'] = False
            self.state['analysis_result'] = None

        self._trigger_ai_if_needed(filepath, filename)

    def get_state(self):
        with self.lock: return self.state.copy()
