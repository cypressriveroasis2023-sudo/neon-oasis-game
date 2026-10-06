// Audit actual rendered styles. Transparent ancestors are composited before
// calculating WCAG text contrast; disabled controls and hidden text are excluded.
export async function auditDarkPresentation(root) {
  return root.evaluate(scope => {
    const rgb = value => (value.match(/[\d.]+/g) || []).map(Number);
    const blend = (a, b) => {
      const alpha = a[3] ?? 1;
      return a.slice(0, 3).map((v, i) => v * alpha + b[i] * (1 - alpha));
    };
    const luminance = color => color.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const background = element => {
      const chain = [];
      for (let node = element; node; node = node.parentElement) chain.unshift(node);
      return chain.reduce((base, node) => blend(rgb(getComputedStyle(node).backgroundColor), base), [11, 17, 28]);
    };
    const failures = [];
    let checked = 0;
    for (const element of scope.querySelectorAll('*')) {
      const style = getComputedStyle(element);
      if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || element.closest(':disabled,[aria-disabled=true]')) continue;
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      const ownText = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent.trim()).filter(Boolean).join(' ');
      const text = ownText || (element.matches('input,textarea') ? element.value || element.placeholder : '');
      if (!text) continue;
      const bg = background(element);
      const fg = blend(rgb(style.color), bg);
      const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
      const contrast = (a + .05) / (b + .05);
      const large = parseFloat(style.fontSize) >= 24 || parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700;
      checked++;
      if (element.matches('input:not([type=checkbox]):not([type=radio]),select,textarea')) {
        const border = blend(rgb(style.borderTopColor), bg);
        const [light, dark] = [luminance(border), luminance(bg)].sort((x, y) => y - x);
        const boundary = (light + .05) / (dark + .05);
        if (boundary + .01 < 3) failures.push({ element: element.tagName.toLowerCase(), text: text.slice(0, 90), boundaryContrast: +boundary.toFixed(2) });
      }
      if (contrast + .01 < (large ? 3 : 4.5)) failures.push({ element: element.tagName.toLowerCase() + '.' + String(element.className).replaceAll(' ', '.'), text: text.slice(0, 90), color: style.color, background: bg.map(Math.round).join(','), contrast: +contrast.toFixed(2) });
    }
    return { checked, failures };
  });
}
