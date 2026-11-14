"use client";

import { useState, type ReactNode } from "react";

type FacadeFrameProps = {
  /** The provider URL, loaded only after the visitor presses the button. */
  src: string;
  /** Accessible name of the frame once loaded. */
  title: string;
  /** Button text; must say where it loads from and that it may set cookies. */
  label: string;
  /** Shown until the click — a local poster or static map. */
  children?: ReactNode;
  /** Rendered next to the button, e.g. the cookie-policy link. */
  aside?: ReactNode;
  className?: string;
  allow?: string;
  /** Shape of the loaded frame, so the page does not jump when it replaces the poster. */
  aspectRatio?: string;
};

/**
 * The one place a third-party frame is created, and only on request. Before the
 * click nothing loads from the provider, so nothing can reach the visitor's
 * device — which is what EU ePrivacy rules require without prior consent. The
 * click is that request.
 */
export function FacadeFrame({ src, title, label, children, aside, className, allow, aspectRatio = "16 / 9" }: FacadeFrameProps) {
  const [loaded, setLoaded] = useState(false);

  if (loaded) {
    return (
      <iframe
        src={src}
        title={title}
        allow={allow}
        allowFullScreen
        className={className}
        style={{ border: 0, display: "block", width: "100%", aspectRatio }}
      />
    );
  }

  return (
    <div className={className} style={{ position: "relative" }}>
      {children}
      <div style={{ position: "absolute", insetInline: 0, bottom: 0, display: "flex", flexWrap: "wrap", gap: "0.5rem", justifyContent: "center", padding: "0.75rem" }}>
        <button type="button" onClick={() => setLoaded(true)} data-embed-load="">
          {label}
        </button>
        {aside}
      </div>
    </div>
  );
}
