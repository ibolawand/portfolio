// src/scripts/cursor.ts

export function initCursor() {
  if (!window.matchMedia("(pointer: fine)").matches) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const cursor = document.getElementById("cursor");
  if (!cursor) return;
  const dot = cursor.querySelector(".cursor-dot") as HTMLElement;
  const ring = cursor.querySelector(".cursor-ring") as HTMLElement;
  if (!dot || !ring) return;

  document.body.classList.add("has-custom-cursor");

  let mouseX = -100;
  let mouseY = -100;
  let dotX = mouseX;
  let dotY = mouseY;
  let ringX = mouseX;
  let ringY = mouseY;
  let isInitialized = false;

  const DOT_EASE = 0.35;
  const RING_EASE = 0.15;

  const onMouseMove = (e: MouseEvent) => {
    mouseX = e.clientX;
    mouseY = e.clientY;

    if (!isInitialized) {
      dotX = ringX = mouseX;
      dotY = ringY = mouseY;
      cursor.style.opacity = "1";
      isInitialized = true;
    }
  };

  const onMouseLeave = () => {
    cursor.style.opacity = "0";
  };

  const onMouseEnter = () => {
    cursor.style.opacity = "1";
  };

  const onMouseDown = () => cursor.classList.add("is-click");
  const onMouseUp = () => cursor.classList.remove("is-click");

  const onMouseOver = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const isLink = !!target.closest("a, button, [role='button']");
    const isText = !!target.closest("input, textarea, [contenteditable]");
    const isProject = !!target.closest(".episode, .panel, .avatar-chat-overlay");

    cursor.classList.toggle("is-hover", isLink);
    cursor.classList.toggle("is-text", isText);
    cursor.classList.toggle("is-project", isProject);
  };

  window.addEventListener("mousemove", onMouseMove, { passive: true });
  document.addEventListener("mouseleave", onMouseLeave);
  document.addEventListener("mouseenter", onMouseEnter);
  window.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  document.addEventListener("mouseover", onMouseOver);

  let rafId: number;

  function tick() {
    if (isInitialized) {
      dotX += (mouseX - dotX) * DOT_EASE;
      dotY += (mouseY - dotY) * DOT_EASE;
      dot.style.transform = `translate3d(${dotX}px, ${dotY}px, 0) translate(-50%, -50%)`;

      ringX += (mouseX - ringX) * RING_EASE;
      ringY += (mouseY - ringY) * RING_EASE;
      ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%)`;
    }

    rafId = requestAnimationFrame(tick);
  }

  tick();

  // Cleanup-Funktion für SPA-Router oder Unmount
  return () => {
    cancelAnimationFrame(rafId);
    window.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseleave", onMouseLeave);
    document.removeEventListener("mouseenter", onMouseEnter);
    window.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mouseup", onMouseUp);
    document.removeEventListener("mouseover", onMouseOver);
    document.body.classList.remove("has-custom-cursor");
  };
}