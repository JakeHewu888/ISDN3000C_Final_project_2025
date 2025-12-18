import os
import glob
import time
from flask import Flask, send_from_directory, jsonify, request
from flask_cors import CORS
from hardware_manager import HardwareManager
from inference import ModelInference

app = Flask(__name__, static_folder='UI')
CORS(app)

# Clean up old captures on startup
def clean_captures():
    files = glob.glob('UI/captures/*')
    for f in files:
        try:
            os.remove(f)
        except:
            pass
    print("[App] Cleaned old captures.")

clean_captures()

# Load AI
model_det = 'best_det.onnx'
model_cls = 'best_cls.onnx'
inference_engine = None
if os.path.exists(model_det) and os.path.exists(model_cls):
    try:
        inference_engine = ModelInference(model_det, model_cls)
        print("[App] AI Models Loaded")
    except Exception as e:
        print(f"[App] AI Load Failed: {e}")

# Init Hardware
hw = HardwareManager(inference_engine=inference_engine, capture_dir='UI/captures')
hw.start()

@app.route('/')
def index():
    return send_from_directory('UI', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('UI', path)

@app.route('/api/state')
def get_state():
    return jsonify(hw.get_state())

@app.route('/api/session/reset', methods=['POST'])
def reset_session():
    hw.reset_session()
    return jsonify({'success': True})

@app.route('/api/upload', methods=['POST'])
def upload_image():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
        
    if file:
        ts = int(time.time())
        filename = f"upload_{ts}.jpg"
        filepath = os.path.join(hw.capture_dir, filename)
        file.save(filepath)
        
        # Inject into hardware manager flow
        # This will update state and trigger AI if in Mode 2
        hw.inject_image(filepath)
        
        return jsonify({'success': True, 'path': filepath})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
