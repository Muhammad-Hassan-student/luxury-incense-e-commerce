import { afterEach, describe, expect, it, vi } from "vitest";
import { cameraCrop, captureCameraFrame } from "./camera-frame";

afterEach(() => vi.unstubAllGlobals());

describe("camera preview framing", () => {
  it.each([
    [1280, 720, { x: 370, y: 0, width: 540, height: 720 }],
    [640, 480, { x: 140, y: 0, width: 360, height: 480 }],
    [720, 1280, { x: 0, y: 160, width: 720, height: 960 }],
    [768, 1024, { x: 0, y: 0, width: 768, height: 1024 }],
  ])("matches a centered portrait preview for a %i by %i camera", (width, height, expected) => {
    expect(cameraCrop(width, height)).toEqual(expected);
  });

  it("probes the exact frozen image retained for verification, even if the camera moves", () => {
    const source = { videoWidth: 1280, videoHeight: 720, readyState: 2 } as HTMLVideoElement;
    let cameraMoment = "first";
    const makeCanvas = () => {
      const canvas = { width: 0, height: 0, pixels: "", getContext: vi.fn(), toDataURL: vi.fn(() => canvas.pixels) };
      const drawImage = vi.fn((input: typeof source | typeof canvas) => {
        canvas.pixels = input === source ? cameraMoment : (input as typeof canvas).pixels;
        cameraMoment = "moved";
      });
      canvas.getContext.mockReturnValue({ drawImage });
      return { canvas, drawImage };
    };
    const full = makeCanvas();
    const probe = makeCanvas();
    const createElement = vi.fn().mockReturnValueOnce(full.canvas).mockReturnValueOnce(probe.canvas);
    vi.stubGlobal("document", { createElement });

    const frame = captureCameraFrame(source);
    expect(frame).toEqual({ probe: "first", full: "first" });
    expect(full.drawImage).toHaveBeenCalledExactlyOnceWith(source, 370, 0, 540, 720, 0, 0, 640, 853);
    expect(probe.drawImage).toHaveBeenCalledExactlyOnceWith(full.canvas, 0, 0, 320, 427);
  });

  it.each([
    { videoWidth: 0, videoHeight: 0, readyState: 0 },
    { videoWidth: 1280, videoHeight: 720, readyState: 1 },
    { videoWidth: 1280, videoHeight: 0, readyState: 2 },
  ])("waits for drawable video data instead of capturing a blank frame: %o", (video) => {
    expect(captureCameraFrame(video as HTMLVideoElement)).toBeNull();
  });
});
