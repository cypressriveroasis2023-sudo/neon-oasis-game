// Leave authentication and password verification with the existing auth client.
let visible = false;
function syncAuth() {
  const now = ['authView', 'forcePasswordView'].some(id => {
    const node = document.getElementById(id);
    return node && !node.classList.contains('hidden');
  });
  document.body.classList.toggle('cos-auth-visible', now);
  if (now && !visible) {
    document.activeElement?.blur?.();
    window.scrollTo({top: 0, left: 0, behavior: 'instant'});
    document.getElementById('app')?.scrollTo({top: 0, left: 0, behavior: 'instant'});
  }
  visible = now;
  for (const id of ['loginUsername','loginPassword']) {
    const input = document.getElementById(id);
    input?.setAttribute('aria-label', id === 'loginUsername' ? 'Username' : 'Password');
    input?.setAttribute('enterkeyhint', id === 'loginUsername' ? 'next' : 'go');
  }
  document.getElementById('loginMessage')?.setAttribute('role','alert');
}
document.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.isComposing || !visible || document.body.classList.contains('busy')) return;
  if (event.target?.id === 'loginUsername') {
    event.preventDefault(); document.getElementById('loginPassword')?.focus();
  } else if (event.target?.id === 'loginPassword') {
    event.preventDefault(); document.querySelector('#authView button[onclick="login()"]')?.click();
  }
});
for (const id of ['authView','forcePasswordView']) {
  const node = document.getElementById(id);
  if (node) new MutationObserver(syncAuth).observe(node,{attributes:true,attributeFilter:['class']});
}
window.addEventListener('pageshow',syncAuth);
syncAuth();
