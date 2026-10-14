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

This source-only branch does not commit compiled Operations dist. The existing
publishing workflow must build the combined reviewed main source. Coordinate
release with the active repair work; do not merge or deploy this draft before
that hold is lifted.
