# Cameras Onsite robotic eye — October 18, 2026

The approved company logo is the red robotic sensor inside white circular sights,
with red CAMERAS and white ONSITE lettering on navy. The eye forms the O.
Company headers, mobile navigation and TV use the full lockup. Login, startup
and VISION AI surfaces use only the square eye and all four sight marks.

The same random-glance scheduler powers both layouts. Only the red sensor moves;
targeting sights, contour and company lettering stay fixed. Each eye chooses its
own horizontal, vertical and diagonal glances and varied pauses. Offscreen and
hidden eyes pause; reduced-motion, print and loading fallbacks are centered.
The existing observer cleanup, single atlas decode and 30fps/512px limits remain.

The approved raster atlas contains the fixed logo, isolated sensor and foreground
contour. `scripts/generate-eye-artwork.mjs` embeds the atlas and separate full-logo
and eye-only posters and generates the legacy renderer from the shared runtime.
Static install icons use the eye-only poster. Legacy document/export containers
remain excluded from the on-screen adapter. No operational reads, writes,
permissions or workflow behavior changes are part of this branding update.

Branding cache tokens and service-worker name advance together. Publish source
through the existing verified-bundle workflow; do not commit local dist output.
