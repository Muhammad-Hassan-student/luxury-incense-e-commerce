/** Match the centered object-cover crop in FaceCapture's 3:4 preview. */
export function cameraCrop(width: number, height: number) {
  const cropWidth = Math.min(width, height * 3 / 4);
  const cropHeight = Math.min(height, width * 4 / 3);
  return { x: (width - cropWidth) / 2, y: (height - cropHeight) / 2, width: cropWidth, height: cropHeight };
}

/** Freeze once: guidance and the retained verification image must describe the same camera frame. */
export function captureCameraFrame(video: HTMLVideoElement) {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
  const crop = cameraCrop(video.videoWidth, video.videoHeight);
  const full = document.createElement("canvas");
  full.width = 640;
  full.height = Math.round(full.width * 4 / 3);
  const ctx = full.getContext("2d");
  if (!ctx) return null;
  // Only the preview is mirrored. Keep the actual image in the camera's orientation.
  ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, full.width, full.height);

  const small = document.createElement("canvas");
  small.width = 320;
  small.height = Math.round(small.width * 4 / 3);
  const probeCtx = small.getContext("2d");
  if (!probeCtx) return null;
  probeCtx.drawImage(full, 0, 0, small.width, small.height);
  return { probe: small.toDataURL("image/jpeg", 0.7), full: full.toDataURL("image/jpeg", 0.85) };
}
