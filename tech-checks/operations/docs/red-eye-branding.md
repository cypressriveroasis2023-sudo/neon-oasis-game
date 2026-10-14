# Cameras Onsite original mechanical eye

The owner's IMG_9119 JPEG is preserved byte-for-byte in
`public/resources/vision-approved-eye.jpeg` and `../resources/vision-ai.jpg`.
No replacement illustration is used. `scripts/generate-eye-artwork.mjs` embeds
those original bytes in self-contained SVG image layers for React and the
legacy renderer, plus a static SVG for application icons.

SVG framing is `viewBox="205 0 914 914"` on the 1320×914 original. The fixed
housing keeps the photographed silver metal, crosshair and surrounding rings.
Only the original optical assembly is clipped at center (659,428), radius 138.
An opaque near-black socket hides the stationary iris underneath. The moving
layer overlays the exact original pixels at center and is clipped to that
socket throughout its ±7.3-source-pixel horizontal glance. The original silver
rim is outside the moving region. In the application's 1254-square viewBox,
the socket is (622.875,587.204), radius 189.335, with ±10px motion.

CSS retains the 12-second glance: center through 1.4s, left at 2.6–4.2s,
right at 6.4–8.6s and center from 10–12s. Reduced-motion/print remain static,
and hidden/offscreen marks pause. App icons use the original static artwork.

Operations/TV and shared legacy loading/sign-in/IT-Service, Camera Health,
Camera Detail, IT repair and VISION brands use the same source. Dynamic VISION
avatars are covered. Document/export exclusions remain; map markers stay plain
circles. Source tests verify embedded image byte identity and renderer parity.

Center/left/right proof images were rendered with Inkscape and compared to the
original. Browser checks must run in CI or an authorized hosted browser;
local browser access is restricted in the implementation executor.
