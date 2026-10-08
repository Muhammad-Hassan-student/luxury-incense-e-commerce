# Face models (camera face check)

Used by `src/server/security/face-engine.ts` (onnxruntime-web, WASM backend, server side only).

| File | Purpose | Source | SHA-256 |
| --- | --- | --- | --- |
| `face_detection_yunet_2023mar.onnx` | YuNet face detector (640×640 input, 5 landmarks) | https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet | `8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4` |
| `face_recognition_sface_2021dec_int8.onnx` | SFace recognizer (112×112 aligned face → 128-d feature), int8 | https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface | `2b0e941e6f16cc048c20aee0c8e31f569118f65d702914540f7bfdc14048d78a` |

Licence: both models are published in OpenCV Zoo under the **Apache License 2.0** (see the LICENSE file in each model
directory of https://github.com/opencv/opencv_zoo). No changes were made to the files.

Verify after download: `sha256sum models/face/*.onnx`.
