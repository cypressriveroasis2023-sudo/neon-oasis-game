// Legacy application branding adapter; generated together with the shared renderer.
const knownImage = 'img[src*="vision-ai.jpg"],img[src*="vision-eye-round.svg"],img[src*="techcheck-eye-favicon-32.png"],img[src*="techcheck-eye-192.png"],img[src*="cameras-on-site-logo.webp"]';
const ignored = '.quote-doc,.quote-doc-header,.invoice-doc,.statement-doc,.print-document,.print-page,.document-preview,.pdf-preview,#printRoot,[data-document-output],[data-print-root]';
const eyes = new Map();
function makeEye(decorative = false, label = 'Cameras Onsite') {
  // Keep the canvas in normal HTML. SVG foreignObject can paint at its
  // unscaled viewBox size in Safari, cropping a close-up into the logo slot.
  const eye = document.createElement('span');
  eye.className = 'cos-static-eye';
  eye.dataset.cosEye = 'approved';
  if (decorative) eye.setAttribute('aria-hidden', 'true');
  else { eye.setAttribute('role', 'img'); eye.setAttribute('aria-label', label); }
  const poster = document.createElement('img');
  poster.setAttribute('class', 'cos-eye-housing cos-eye-poster');
  poster.src = posterArtwork; poster.alt = ''; poster.setAttribute('aria-hidden', 'true');
  const live = document.createElement('span');
  live.className = 'cos-eye-live'; live.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.width = 144; canvas.height = 144;
  live.append(canvas); eye.append(poster, live);
  eyes.set(eye, mountRobotEye(eye, canvas));
  return eye;
}
function addBrand(parent) {
  if (!parent || parent.querySelector(':scope > .cos-added-brand')) return;
  const link = document.createElement('a');
  link.className = 'cos-added-brand'; link.href = './onsite-vision.html';
  link.setAttribute('aria-label', 'Open OnSite Vision');
  link.append(makeEye(true));
  const copy = document.createElement('span');
  copy.innerHTML = '<strong>VISION</strong><small>CAMERAS ONSITE</small>';
  link.append(copy); parent.prepend(link);
}
function scan(root) {
  if (!(root instanceof Element)) return;
  const images = [...(root.matches(knownImage) ? [root] : []), ...root.querySelectorAll(knownImage)];
  for (const image of images) {
    if (!image.isConnected || image.closest(ignored)) continue;
    const svg = makeEye(image.getAttribute('alt') === '', image.getAttribute('alt') || 'Cameras Onsite');
    if (image.id) svg.id = image.id;
    // Preserve compact inline-avatar slots rather than enlarging application controls.
    const width = image.getBoundingClientRect().width;
    if (width > 0 && width < 64) { svg.style.width = width + 'px'; svg.style.height = width + 'px'; }
    image.replaceWith(svg);
  }
  // Earlier Tech Check headers paint the eye as a CSS background instead of an img.
  for (const parent of [...(root.matches('.brandTarget') ? [root] : []), ...root.querySelectorAll('.brandTarget')]) {
    if (!parent.closest(ignored) && !parent.querySelector(':scope > .cos-static-eye')) parent.append(makeEye(true));
  }
  for (const parent of [...(root.matches('.vision-brand-v36,.vision-top-title') ? [root] : []), ...root.querySelectorAll('.vision-brand-v36,.vision-top-title')]) {
    if (!parent.querySelector(':scope > .cos-static-eye')) parent.prepend(makeEye(true));
  }
}
function refresh() {
  scan(document.body);
  if (/camera-detail\.html$/.test(location.pathname)) addBrand(document.querySelector('.topbar'));
  if (/it-send-repair\.html$/.test(location.pathname)) addBrand(document.querySelector('.hero'));
}
function start() {
  refresh();
  const mutations = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) scan(node);
    for (const [eye, dispose] of eyes) if (!eye.isConnected) { dispose(); eyes.delete(eye); }
  });
  mutations.observe(document.body, { childList: true, subtree: true });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
