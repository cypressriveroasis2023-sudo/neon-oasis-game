document.addEventListener('click', ev => {
  if (!ev.target.closest('.evidence-upload-photos,.evidence-save-signature')) return;
  const serviceCard = ev.target.closest('#matchedPreps > .item.prepared');
  if (!serviceCard) return;
  serviceCard.dataset.evidenceReady = '';
  serviceCard.querySelectorAll('.evidence-proof').forEach(node => node.remove());
});
