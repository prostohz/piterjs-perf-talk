(() => {
  const slides = Array.from(document.querySelectorAll('.slide'));
  if (!slides.length) return;
  let index = 0;
  const fragments = () => Array.from(slides[index].querySelectorAll('[data-fragment]'));
  const resize = () => document.documentElement.style.setProperty('--scale', Math.min(innerWidth / 1600, innerHeight / 900));
  const goTo = (next, reveal = false) => {
    index = Math.max(0, Math.min(slides.length - 1, next));
    slides.forEach((slide, i) => {
      slide.classList.toggle('is-active', i === index);
      slide.inert = i !== index;
      slide.querySelectorAll('[data-fragment]').forEach(el => el.classList.toggle('revealed', i === index && reveal));
    });
    history.replaceState(null, '', `#${slides[index].id}`);
  };
  const fromHash = () => {
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { id = ''; }
    goTo(Math.max(0, slides.findIndex(slide => slide.id === id)));
  };
  const forward = () => {
    const hidden = fragments().find(el => !el.classList.contains('revealed'));
    if (hidden) hidden.classList.add('revealed');
    else if (index < slides.length - 1) goTo(index + 1);
  };
  const backward = () => {
    const shown = fragments().filter(el => el.classList.contains('revealed'));
    if (shown.length) shown.at(-1).classList.remove('revealed');
    else if (index > 0) goTo(index - 1, true);
  };
  addEventListener('keydown', async event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) {
      event.preventDefault();
      if (event.key === ' ' && event.shiftKey) backward();
      else forward();
    } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) {
      event.preventDefault();
      backward();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      goTo(event.key === 'Home' ? 0 : slides.length - 1, event.key === 'End');
    } else if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch (error) { console.warn('Полноэкранный режим недоступен', error); }
    } else if (event.key === 'Escape' && document.fullscreenElement) {
      await document.exitFullscreen();
    }
  });
  addEventListener('resize', resize);
  addEventListener('hashchange', fromHash);
  window.deck = { goTo, get index() { return index; }, get count() { return slides.length; } };
  resize();
  fromHash();
})();
