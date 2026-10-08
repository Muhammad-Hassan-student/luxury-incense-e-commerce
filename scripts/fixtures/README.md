# Test fixtures (sign-in security checks)

- `astronaut.png` — NASA portrait of astronaut Eileen Collins, as shipped in scikit-image's sample data
  (`skimage/data/astronaut.png`, fetched from the v0.19.3 tag). The photo is a work of the U.S. federal government
  (NASA) and is in the **public domain**; scikit-image lists it as such.
  SHA-256 `88431cd9653ccd539741b555fb0a46b61558b301d4110412b5bc28b5e3ea6cb5`.
- `nasa-portrait-wilcutt.jpg` — official NASA portrait of astronaut Terrence W. Wilcutt (NASA image `jsc2003e41874`,
  https://images.nasa.gov/details/jsc2003e41874). NASA imagery is generally not copyrighted (public domain, U.S. federal
  government work). Used as the "different person" face. A mirrored or cropped astronaut image would NOT work for that:
  the recognizer correctly matches a flipped copy of the same face (cosine ≈ 0.94), so a genuinely different person
  is needed. SHA-256 `b5321a6f012748377fc4a1d25854427b2a46bbb95021cce9c697ae62d2d656fe`.

The checks derive zooming JPEG frames from these in memory with sharp; no derived images are written to disk.
