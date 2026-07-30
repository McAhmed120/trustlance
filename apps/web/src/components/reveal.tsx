'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Scroll-triggered reveal, as on Upwork's marketing pages: content starts
 * slightly low and transparent, then eases up into place the first time it
 * enters the viewport.
 *
 * IntersectionObserver rather than a scroll listener — the browser does the
 * work off the main thread, and there's no per-frame handler to jank scrolling.
 *
 * Reveals fire ONCE and then unobserve. Re-animating on every scroll-past is
 * the thing that makes this pattern feel cheap, and it fights the user when
 * they scroll back up to re-read something.
 */
export function Reveal({
  children,
  delay = 0,
  as = 'div',
  className = '',
}: {
  children: React.ReactNode;
  /** Stagger in ms, for revealing a row of cards in sequence. */
  delay?: number;
  as?: 'div' | 'section' | 'li' | 'article';
  className?: string;
}) {
  // Widened to ElementType: a union of concrete tags makes the ref type an
  // impossible intersection (HTMLDivElement & HTMLLIElement & …), which no
  // single ref can satisfy.
  const Tag = as as React.ElementType;
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    /*
     * Reduced motion is handled purely in CSS: the
     * `@media (prefers-reduced-motion: reduce)` block forces .reveal to full
     * opacity regardless of data-revealed. Doing it here as well would mean a
     * synchronous setState in the effect body — a cascading render for no gain,
     * since the styling already covers it.
     */
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setShown(true);
            io.unobserve(entry.target);
          }
        }
      },
      // Fire slightly before the element is fully on screen, so the animation
      // is already finishing as the user arrives at it.
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
    );

    io.observe(el);
    return () => {
      io.disconnect();
    };
  }, []);

  return (
    <Tag
      ref={ref}
      data-revealed={shown ? 'true' : 'false'}
      style={{ transitionDelay: `${delay}ms` }}
      className={`reveal ${className}`}
    >
      {children}
    </Tag>
  );
}
