# Cameras Onsite robotic eye

The approved 2026-10-14 design is a single bright-red optical lens with four fixed
sight marks, silver eyelids and a dark machined circular housing. The recessed
socket contains overlapping metal shutter blades, bearing rings and reflected
red light. The lens chooses independent random left/right, straight, vertical
and diagonal glances, with short servo turns and varied lock-on pauses.

`robotEyeRuntime.ts` and `robotEyeMechanics.ts` are the shared presentation source.
`scripts/generate-eye-artwork.mjs` generates the self-contained legacy renderer
from that same source, with a source hash to detect drift. The approved atlas and
centered poster are in `public/resources/robot-eye-*.webp`; `eyeArtwork.ts` embeds
these exact bytes. The static round SVG, avatar image, favicon, installation and
Apple-touch icons show the same centered design. The earlier reference remains
archived in `public/resources/vision-approved-eye.jpeg`.

Operations desktop/mobile branding, TV Board and all existing legacy
loading/sign-in, IT/Service, Camera Health, Camera Detail, IT repair and VISION
branding slots use the shared eye. Dynamically added assistant avatars are
included. Compact inline slots retain their dimensions and surrounding controls.
Document/export markup is not replaced; static icon consumers receive the new
centered artwork. Field Map markers retain their existing plain status circles.

One decoded atlas and one frame scheduler serve each application context. Motion
is capped at 30 frames per second and 512 backing pixels per eye. Hidden/offscreen
eyes pause, removed eyes dispose their observers, and reduced-motion and print
views stay centered. Loading failures retain the centered poster. No operational
reads, writes, routing, permissions or data sources are involved.

The live canvas and centered poster use ordinary HTML layers in a square,
clipped holder. Avoid SVG `foreignObject`: Safari can paint its canvas without
the SVG viewBox scaling, producing a cropped close-up even when DOM bounds look
correct. Mobile headers use a 40px eye, navigation drawers use 48px, and welcome
art is capped at 128px with the existing available-height constraint. Desktop
branding retains its dimensions. Pixel checks inspect all four sight marks in
the rendered screenshot as well as random movement and paused backing pixels.

Build the Operations bundle from current reviewed source and retain all existing
release checks. Branding script/style and worker cache versions must advance
together when the renderer changes. Static icon artwork is unchanged by the
mobile framing fix.
