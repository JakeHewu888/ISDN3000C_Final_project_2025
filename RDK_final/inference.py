import cv2
import numpy as np
import onnxruntime as ort
import os

class ModelInference:
    def __init__(self, det_model_path, cls_model_path):
        self.det_session = ort.InferenceSession(det_model_path)
        self.cls_session = ort.InferenceSession(cls_model_path)
        
        # raw labels from model
        self.cls_labels = ['skin_cancer', 'eczema', 'unknown'] 
        
        self.det_shape = (640, 640)
        self.cls_shape = (224, 224) 
        
        self.conf_threshold = 0.25
        self.iou_threshold = 0.45

    def preprocess(self, image, target_shape):
        shape = image.shape[:2]
        r = min(target_shape[0] / shape[0], target_shape[1] / shape[1])
        new_unpad = int(round(shape[1] * r)), int(round(shape[0] * r))
        
        dw, dh = target_shape[1] - new_unpad[0], target_shape[0] - new_unpad[1]
        dw /= 2
        dh /= 2

        if shape[::-1] != new_unpad:
            image = cv2.resize(image, new_unpad, interpolation=cv2.INTER_LINEAR)
        
        top, bottom = int(round(dh - 0.1)), int(round(dh + 0.1))
        left, right = int(round(dw - 0.1)), int(round(dw + 0.1))
        
        img = cv2.copyMakeBorder(image, top, bottom, left, right, cv2.BORDER_CONSTANT, value=(114, 114, 114))
        
        img = img.transpose((2, 0, 1))[::-1] 
        img = np.ascontiguousarray(img)
        img = img.astype(np.float32) / 255.0
        img = img[None] 
        return img, (r, (dw, dh))

    def xywh2xyxy(self, x):
        y = np.copy(x)
        y[..., 0] = x[..., 0] - x[..., 2] / 2
        y[..., 1] = x[..., 1] - x[..., 3] / 2
        y[..., 2] = x[..., 0] + x[..., 2] / 2
        y[..., 3] = x[..., 1] + x[..., 3] / 2
        return y

    def nms(self, prediction):
        prediction = prediction[0].transpose(1, 0)
        boxes = prediction[:, :4]
        scores = np.max(prediction[:, 4:], axis=1)
        
        print(f"[AI Debug] Max detection confidence: {np.max(scores):.4f}")
        
        mask = scores > self.conf_threshold
        boxes = boxes[mask]
        scores = scores[mask]
        
        if len(boxes) == 0:
            return []

        boxes = self.xywh2xyxy(boxes)
        indices = cv2.dnn.NMSBoxes(boxes.tolist(), scores.tolist(), self.conf_threshold, self.iou_threshold)
        
        if len(indices) == 0:
            return []
            
        return [boxes[i] for i in indices.flatten()]

    def run_inference(self, image_path):
        original_img = cv2.imread(image_path)
        if original_img is None:
            raise ValueError(f"Could not read image: {image_path}")
            
        img_h, img_w = original_img.shape[:2]
        
        # 1. Detection
        input_tensor, (ratio, (dw, dh)) = self.preprocess(original_img, self.det_shape)
        input_name = self.det_session.get_inputs()[0].name
        det_output = self.det_session.run(None, {input_name: input_tensor})
        
        boxes = self.nms(det_output[0])
        results = []
        
        annotated_img = original_img.copy()

        if boxes:
            for box in boxes:
                x1 = int((box[0] - dw) / ratio)
                y1 = int((box[1] - dh) / ratio)
                x2 = int((box[2] - dw) / ratio)
                y2 = int((box[3] - dh) / ratio)
                x1, y1 = max(0, x1), max(0, y1)
                x2, y2 = min(img_w, x2), min(img_h, y2)
                
                crop = original_img[y1:y2, x1:x2]
                if crop.size == 0: continue
                
                # 2. Classification
                cls_input, _ = self.preprocess(crop, self.cls_shape)
                cls_name = self.cls_session.get_inputs()[0].name
                cls_output = self.cls_session.run(None, {cls_name: cls_input})
                
                probs = cls_output[0][0]
                cls_idx = np.argmax(probs)
                confidence = float(probs[cls_idx])
                
                label = self.cls_labels[cls_idx] if cls_idx < len(self.cls_labels) else 'unknown'
                
                print(f"[AI Debug] Class: {label}, Conf: {confidence:.4f}")

                results.append({
                    "bbox": [x1, y1, x2, y2],
                    "class": label,
                    "confidence": confidence
                })
                
                if label == 'skin_cancer':
                    color = (0, 0, 255) # Red
                elif label == 'eczema':
                    color = (0, 165, 255) # Orange
                else:
                    color = (0, 255, 0) # Green

                cv2.rectangle(annotated_img, (x1, y1), (x2, y2), color, 2)
                cv2.putText(annotated_img, f"{label} {confidence:.2f}", (x1, y1-10), 
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

        # Status Logic
        status = "normal"
        if any(r['class'] == 'skin_cancer' for r in results):
            status = "detected"
        elif any(r['class'] == 'eczema' for r in results):
            status = "detected" # Or 'warning'

        annotated_path = image_path.replace('.jpg', '_annotated.jpg')
        cv2.imwrite(annotated_path, annotated_img)
        
        return {
            "status": status,
            "predictions": results,
            "annotatedPath": annotated_path
        }
