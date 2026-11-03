import { gsap } from "gsap";
import { Flip } from "gsap/Flip";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

gsap.registerPlugin(Flip, ScrollTrigger);

const PACE = 0.65;
gsap.globalTimeline.timeScale(PACE);

const mq = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
export const reducedMotion = () => mq?.matches ?? false;

export function reveal(node: HTMLElement, opts: { selector?: string; y?: number; stagger?: number } = {}) {
  if (reducedMotion()) return {};
  const ctx = gsap.context(() => {
    const targets = opts.selector ? Array.from(node.querySelectorAll(opts.selector)) : [node];
    if (targets.length === 0) return;
    gsap.from(targets, {
      opacity: 0,
      y: opts.y ?? 10,
      duration: 0.42,
      ease: "power3.out",
      stagger: opts.stagger ?? 0.035,
      clearProps: "opacity,transform",
    });
  }, node);
  return { destroy: () => ctx.revert() };
}

export function popIn(node: HTMLElement) {
  if (reducedMotion()) return {};
  const tween = gsap.from(node, { opacity: 0, scale: 0.97, y: 6, duration: 0.24, ease: "power2.out", clearProps: "all" });
  return { destroy: () => tween.kill() };
}

export function flipCapture(container: HTMLElement | null | undefined, selector: string) {
  if (!container || reducedMotion()) return () => {};
  const state = Flip.getState(container.querySelectorAll(selector));
  return () => {
    Flip.from(state, {
      targets: container.querySelectorAll(selector),
      duration: 0.38,
      ease: "power3.inOut",
      absolute: false,
      nested: true,
      prune: true,
      onEnter: (els) => gsap.fromTo(els, { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: 0.3 }),
    });
  };
}

export function flash(el: Element | null | undefined) {
  if (!el || reducedMotion()) return;
  gsap.fromTo(
    el,
    { boxShadow: "0 0 0 2px rgba(184, 135, 43, 0.45)" },
    { boxShadow: "0 0 0 0px rgba(184, 135, 43, 0)", duration: 0.9, ease: "power2.out", clearProps: "boxShadow" },
  );
}

export function smoothScroll(wrapper: HTMLElement) {
  if (reducedMotion()) return {};
  const content = wrapper.firstElementChild as HTMLElement | null;
  if (!content) return {};
  const lenis = new Lenis({
    wrapper,
    content,
    autoRaf: false,
    lerp: 0.14,
    wheelMultiplier: 1,
    smoothWheel: true,
    prevent: (node: HTMLElement) =>
      node.tagName === "TEXTAREA" || node.tagName === "SELECT" || node.hasAttribute("data-lenis-prevent"),
  });
  const tick = (time: number) => lenis.raf(time * 1000);
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
  return {
    destroy() {
      gsap.ticker.remove(tick);
      lenis.destroy();
    },
  };
}

export function batchReveal(node: HTMLElement, opts: { selector: string; y?: number }) {
  if (reducedMotion()) return {};
  const scroller = node.closest<HTMLElement>("[data-scroller]") ?? undefined;
  const ctx = gsap.context(() => {
    const targets = gsap.utils.toArray<HTMLElement>(opts.selector, node);
    if (!targets.length) return;
    gsap.set(targets, { opacity: 0, y: opts.y ?? 14 });
    ScrollTrigger.batch(targets, {
      scroller,
      start: "top 96%",
      once: true,
      onEnter: (batch) =>
        gsap.to(batch, { opacity: 1, y: 0, duration: 0.45, ease: "power3.out", stagger: 0.05, overwrite: true, clearProps: "opacity,transform" }),
    });
    ScrollTrigger.refresh();
  }, node);
  return { destroy: () => ctx.revert() };
}

export function flipList(getContainer: () => HTMLElement | null | undefined, selector: string) {
  let pending: (() => void) | null = null;
  return {
    before() {
      pending = flipCapture(getContainer(), selector);
    },
    after() {
      pending?.();
      pending = null;
    },
  };
}

export function hscroll(node: HTMLElement) {
  node.setAttribute("data-lenis-prevent", "");
  const edges = () => {
    node.classList.toggle("fade-l", node.scrollLeft > 2);
    node.classList.toggle("fade-r", node.scrollLeft + node.clientWidth < node.scrollWidth - 2);
  };
  const wheel = (e: WheelEvent) => {
    if (node.scrollWidth <= node.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    node.scrollLeft += e.deltaY;
  };
  const click = (e: MouseEvent) => {
    const tab = (e.target as HTMLElement).closest("button");
    if (tab && node.contains(tab)) tab.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  };
  const resize = new ResizeObserver(edges);
  resize.observe(node);
  const children = new MutationObserver(edges);
  children.observe(node, { childList: true, subtree: true });
  node.addEventListener("wheel", wheel, { passive: false });
  node.addEventListener("scroll", edges, { passive: true });
  node.addEventListener("click", click);
  edges();
  return {
    destroy() {
      resize.disconnect();
      children.disconnect();
      node.removeEventListener("wheel", wheel);
      node.removeEventListener("scroll", edges);
      node.removeEventListener("click", click);
    },
  };
}

export function clickSpark(node: HTMLElement, color = "#e2b65a") {
  const onClick = (e: MouseEvent) => {
    if (reducedMotion() || (node as HTMLButtonElement).disabled) return;
    const count = 8;
    for (let i = 0; i < count; i++) {
      const s = document.createElement("span");
      s.className = "spark";
      s.style.left = `${e.clientX}px`;
      s.style.top = `${e.clientY}px`;
      s.style.background = color;
      const angle = (i / count) * Math.PI * 2;
      s.style.transform = `rotate(${angle}rad)`;
      document.body.appendChild(s);
      gsap.fromTo(
        s,
        { x: 0, y: 0, scaleX: 1, opacity: 1 },
        { x: Math.cos(angle) * 18, y: Math.sin(angle) * 18, scaleX: 0.2, opacity: 0, duration: 0.45, ease: "power2.out", onComplete: () => s.remove() },
      );
    }
  };
  node.addEventListener("click", onClick);
  return { destroy: () => node.removeEventListener("click", onClick) };
}

export function magnet(node: HTMLElement, strength = 0.22) {
  if (reducedMotion()) return {};
  const xTo = gsap.quickTo(node, "x", { duration: 0.35, ease: "power3.out" });
  const yTo = gsap.quickTo(node, "y", { duration: 0.35, ease: "power3.out" });
  const move = (e: PointerEvent) => {
    const r = node.getBoundingClientRect();
    xTo((e.clientX - (r.left + r.width / 2)) * strength);
    yTo((e.clientY - (r.top + r.height / 2)) * strength);
  };
  const leave = () => gsap.to(node, { x: 0, y: 0, duration: 0.6, ease: "elastic.out(1, 0.45)" });
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerleave", leave);
  return {
    destroy() {
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerleave", leave);
      gsap.killTweensOf(node);
    },
  };
}

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&*+=<>/";

export function decrypt(node: HTMLElement, text: string) {
  let tween: gsap.core.Tween | null = null;
  const release = () => {
    node.style.width = "";
    node.style.overflow = "";
  };
  const play = (target: string) => {
    tween?.kill();
    node.textContent = target;
    release();
    if (reducedMotion() || !node.isConnected) return;
    node.style.display = "inline-block";
    node.style.whiteSpace = "nowrap";
    node.style.verticalAlign = "bottom";
    node.style.width = `${node.getBoundingClientRect().width}px`;
    node.style.overflow = "hidden";
    const state = { p: 0 };
    tween = gsap.to(state, {
      p: 1,
      duration: Math.min(0.7, 0.18 + target.length * 0.012),
      ease: "power1.out",
      onUpdate: () => {
        const revealed = Math.floor(state.p * target.length);
        let out = target.slice(0, revealed);
        for (let i = revealed; i < target.length; i++) {
          out += target[i] === " " ? " " : GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        }
        node.textContent = out;
      },
      onComplete: () => {
        node.textContent = target;
        release();
      },
    });
  };
  let current = text;
  play(text);
  return {
    update(next: string) {
      if (next === current) return;
      current = next;
      play(next);
    },
    destroy() {
      tween?.kill();
    },
  };
}

export function holdToConfirm(node: HTMLElement, opts: { duration?: number; onconfirm: () => void }) {
  const fill = document.createElement("span");
  fill.className = "hold-fill";
  node.classList.add("holdable");
  node.prepend(fill);
  let options = opts;
  let tween: gsap.core.Tween | null = null;
  const start = (e: Event) => {
    if ((node as HTMLButtonElement).disabled) return;
    if (e instanceof KeyboardEvent && (e.repeat || (e.key !== "Enter" && e.key !== " "))) return;
    e.preventDefault();
    tween?.kill();
    tween = gsap.to(fill, {
      scaleX: 1,
      duration: ((options.duration ?? 900) / 1000) * PACE,
      ease: "none",
      onComplete: () => {
        gsap.to(fill, { scaleX: 0, duration: 0.25, delay: 0.1 });
        options.onconfirm();
      },
    });
  };
  const cancel = () => {
    if (!tween || tween.progress() === 1) return;
    tween.kill();
    gsap.to(fill, { scaleX: 0, duration: 0.2, ease: "power2.out" });
  };
  node.addEventListener("pointerdown", start);
  node.addEventListener("keydown", start);
  for (const ev of ["pointerup", "pointerleave", "keyup", "blur"]) node.addEventListener(ev, cancel);
  return {
    update(next: typeof opts) {
      options = next;
    },
    destroy() {
      tween?.kill();
      node.removeEventListener("pointerdown", start);
      node.removeEventListener("keydown", start);
      for (const ev of ["pointerup", "pointerleave", "keyup", "blur"]) node.removeEventListener(ev, cancel);
      fill.remove();
    },
  };
}

export function spotlight(node: HTMLElement) {
  const move = (e: PointerEvent) => {
    const r = node.getBoundingClientRect();
    node.style.setProperty("--mx", `${e.clientX - r.left}px`);
    node.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  node.classList.add("spotlight");
  node.addEventListener("pointermove", move);
  return { destroy: () => node.removeEventListener("pointermove", move) };
}

export function countUp(node: HTMLElement, value: number) {
  let current = value;
  let tween: gsap.core.Tween | null = null;
  node.textContent = String(value);
  return {
    update(next: number) {
      tween?.kill();
      if (reducedMotion() || next === current) {
        current = next;
        node.textContent = String(next);
        return;
      }
      const obj = { v: current };
      tween = gsap.to(obj, {
        v: next,
        duration: 0.5,
        ease: "power3.out",
        onUpdate: () => {
          node.textContent = String(Math.round(obj.v));
        },
      });
      current = next;
    },
    destroy() {
      tween?.kill();
    },
  };
}

export { gsap };
