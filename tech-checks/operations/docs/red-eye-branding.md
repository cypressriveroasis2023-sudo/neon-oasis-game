# Approved Cameras Onsite header eye

The header uses the exact imagegen housing/lens layers approved on 2026-10-06,
including the smooth brow. The original artwork's dimensions and padding are
preserved in lossless WebP packaging (320px housing, 160px lens), suitable for
104px desktop and 64px mobile marks at high device density. No GIF/video or
frame-by-frame JavaScript runs in the header. The existing VISION and COS
Operations text and circular layout dimensions are preserved.

The SVG viewBox is 1254 square. Housing is fixed. The lens is at (422,375),
410 square, clipped to the original aperture. CSS uses the approved 12-second
loop: center through 1.4s, -42 at 2.6–4.2s, +42 at 6.4–8.6s, center from
10–12s, with smoothstep interpolation. There is no vertical movement, scale,
opacity modulation, zoom or pulsation. Reduced-motion and print are static.
Animation pauses when the mark is offscreen or its document is hidden.

Branding is presentation-only. Authentication, workflows and backend code
are unchanged. The AppDeploy shell uses the identical component/styles/art.

## Consistent application surfaces

The shared `cos-eye-branding.js`/`.css` renderer supplies the same approved art
to the legacy host/loading/sign-in/IT-Service brands, Camera Health, Camera
Detail, IT repair, and OnSite Vision sidebar, mobile bar, hero and conversation
avatars. It preserves surrounding buttons and links, labels and auth boundaries.
Business-document preview/export logos are deliberately excluded.

OnSite Vision respects the composer's bounded viewport and adaptive hero size.
Only the approved lens moves; superseded decorative pulse/float rings are hidden.
The native/AppDeploy owner dashboard mark is enlarged to 104px desktop and
64px mobile so its original subtle gaze is visible at normal viewing distance.
