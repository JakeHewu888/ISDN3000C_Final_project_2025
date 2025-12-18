# Skin Screening AI Project

This repository contains the complete source code for a Skin Screening AI system running on RDK X5 hardware. It includes two versions of the UI: the fully integrated backend version (Final_project) and the standalone frontend prototype (UI_prototype).

## Folder Structure

*   **`Final_project/`** (Main Project)
    *   **Description**: The complete, integrated system. It runs a Python Flask server on the RDK X5 which handles hardware control (Camera, Buttons, LEDs), AI inference (YOLO ONNX), and serves the Web UI.
    *   **Use Case**: Deploy this on the RDK X5 device for the actual application.

*   **`UI_prototype/`** (Original Frontend)
    *   **Description**: The initial static website prototype. It contains only HTML/CSS/JS and mock data logic.
    *   **Use Case**: For frontend development or previewing the layout without hardware. Requires VSCode Live Server.

---

## How to Run

### 1. Final_project (On RDK X5)

This is the production mode.

1.  **Transfer files**: Copy the `Final_project` folder to your RDK X5.
2.  **Install dependencies**:
    ```bash
    cd Final_project
    pip install -r requirements.txt
    ```
    *(Note: Ensure `Hobot.GPIO` or `RPi.GPIO` is available on the system)*
3.  **Run the server**:
    ```bash
    python3 app.py
    ```
4.  **Access the UI**:
    *   Connect your PC/Phone to the RDK's Wi-Fi hotspot (or same network).
    *   Open a browser and go to `http://<RDK_IP>:5000` (e.g., `http://10.42.0.1:5000`).

**Hardware Controls:**
*   **Button 1**: Capture Photo / Confirm
*   **Button 2**: Switch Mode (Mode 1: Portrait / Mode 2: AI Analysis)

### 2. UI_prototype (On PC/Mac)

This is for UI testing only.

1.  Open the `UI_prototype` folder in **VSCode**.
2.  Install the **Live Server** extension.
3.  Right-click `index.html` and select **"Open with Live Server"**.
4.  The static website will open in your default browser (using mock data).

---

## AI Models

The `Final_project` uses two ONNX models located in the root:
*   `best_det.onnx`: YOLOv8 Detection Model (Locates skin lesions).
*   `best_cls.onnx`: Classification Model (Classifies lesion as Eczema or Skin Cancer).

