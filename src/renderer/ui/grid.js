// The Alt key watcher that switches to the Alt grid while held (the controls are ui/gridCard.js).

/** Call `setAlt(true/false)` as Alt goes down and up while `ws` is the active workspace. */
export function watchAlt(ws, setAlt) {
  const onKey = (e) => {
    if (e.key !== 'Alt' || !ws.el.classList.contains('active')) return;
    setAlt(e.type === 'keydown');
    if (e.type === 'keyup') e.preventDefault(); // keep the desktop app's menu bar from taking focus
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKey);
  window.addEventListener('blur', () => setAlt(false));
}
