/**
 * Inline marks for the "Built on" strip.
 *
 * Hand-drawn SVG rather than downloaded brand assets, for three reasons:
 * they load with the document (no extra requests, no CDN dependency, and the
 * strict CSP stays intact), they scale cleanly, and nothing trademarked gets
 * committed to the repo as a binary.
 *
 * These are simplified interpretations, not official artwork — recognition
 * comes from silhouette plus brand colour. Marks whose real logo is black or
 * near-black use `currentColor` so they stay legible in dark mode; the rest
 * keep their brand colour, which reads correctly on both themes.
 */

export type MarkName =
  | 'ed25519'
  | 'jws'
  | 'postgresql'
  | 'redis'
  | 'prisma'
  | 'nextjs'
  | 'socketio';

export function TechMark({ name, className = 'size-8' }: { name: MarkName; className?: string }) {
  const common = { viewBox: '0 0 32 32', className, 'aria-hidden': true as const };

  switch (name) {
    /* Ed25519 is an algorithm with no logo — a key glyph carries the meaning. */
    case 'ed25519':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="6" />
          <path d="M15.5 15.5 27 27" />
          <path d="M23 23l-3 3M27 19l-3 3" />
        </svg>
      );

    /* JWS/JWT: a seal over a document — the "signed payload" idea. */
    case 'jws':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
          <path d="M7 4h11l7 7v17H7z" />
          <path d="M18 4v7h7" />
          <circle cx="16" cy="20" r="4" fill="var(--accent)" stroke="none" />
        </svg>
      );

    /*
     * PostgreSQL: a database cylinder in the project's blue.
     *
     * Deliberately NOT the elephant. Two hand-written attempts at Slonik read
     * as a balloon and then a horseshoe at 36px — a mangled mascot is worse
     * than no mascot. A cylinder is instantly legible as "database" and keeps
     * the brand colour doing the identification work.
     */
    case 'postgresql':
      return (
        <svg {...common} fill="none" stroke="#336791" strokeWidth="2" strokeLinecap="round">
          <ellipse cx="16" cy="8" rx="10" ry="4" />
          <path d="M6 8v16c0 2.2 4.5 4 10 4s10-1.8 10-4V8" />
          <path d="M6 16c0 2.2 4.5 4 10 4s10-1.8 10-4" />
        </svg>
      );

    /* Redis: the stacked data layers. */
    case 'redis':
      return (
        <svg {...common} fill="none" stroke="#ff4438" strokeWidth="2" strokeLinejoin="round">
          <path d="M4 9l12-5 12 5-12 5z" />
          <path d="M4 16l12 5 12-5" />
          <path d="M4 23l12 5 12-5" />
        </svg>
      );

    /* Prisma: the angular prism. Real mark is near-black, so it follows theme. */
    case 'prisma':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
          <path d="M11 3 25 24 9 29 7 11z" />
        </svg>
      );

    /* Next.js: circle with the N stroke. */
    case 'nextjs':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="16" cy="16" r="13" />
          <path d="M11 22V10l11 13" strokeLinejoin="round" />
          <path d="M21 10v8" />
        </svg>
      );

    /* Socket.IO: bidirectional transport inside a ring. */
    case 'socketio':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="16" cy="16" r="13" />
          <path d="M10 13h9l-3-3" />
          <path d="M22 19h-9l3 3" />
        </svg>
      );
  }
}
