"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

type Review = { quote: string; author: string };

type Props = {
  reviews: Review[];
  labels: { region: string };
};

const AUTO_MS = 5500;
const EDGE_MS = 1100;

export function ReviewsCarousel({ reviews, labels }: Props) {
  const track = useRef<HTMLUListElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [edge, setEdge] = useState<-1 | 0 | 1>(0);

  const measure = useCallback(() => {
    const el = track.current;
    if (el) setOverflowing(el.scrollWidth > el.clientWidth + 4);
  }, []);

  const step = useCallback((dir: 1 | -1, wrap = true) => {
    const el = track.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    const width = card ? card.offsetWidth + 32 : el.clientWidth;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    const atStart = el.scrollLeft <= 4;
    if ((dir === 1 && atEnd) || (dir === -1 && atStart)) {
      if (!wrap) return;
    }
    if (dir === 1 && atEnd) el.scrollTo({ left: 0, behavior: "smooth" });
    else if (dir === -1 && atStart) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
    else el.scrollBy({ left: dir * width, behavior: "smooth" });
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, reviews.length]);

  useEffect(() => {
    if (!overflowing || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => step(1), AUTO_MS);
    return () => window.clearInterval(id);
  }, [overflowing, paused, step]);

  useEffect(() => {
    if (!overflowing || edge === 0) return;
    step(edge, false);
    const id = window.setInterval(() => step(edge, false), EDGE_MS);
    return () => window.clearInterval(id);
  }, [overflowing, edge, step]);

  const onTrackMouseMove = (e: MouseEvent<HTMLUListElement>) => {
    if (!overflowing || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const zone = Math.min(140, rect.width * 0.15);
    const dir = x < zone ? -1 : x > rect.width - zone ? 1 : 0;
    if (dir !== edge) setEdge(dir);
  };

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label={labels.region}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
    >
      <ul
        ref={track}
        tabIndex={overflowing ? 0 : undefined}
        onMouseMove={onTrackMouseMove}
        onMouseLeave={() => setEdge(0)}
        className={`${edge === -1 ? "cursor-w-resize " : edge === 1 ? "cursor-e-resize " : ""}-mx-4 mt-12 flex snap-x snap-mandatory gap-8 overflow-x-auto px-4 pb-8 [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent`}
      >
        {reviews.map((review, i) => {
          const featured = i % 3 === 1;
          return (
            <li key={i} className="w-[85%] shrink-0 snap-start sm:w-[calc(50%-1rem)] md:w-[calc((100%-4rem)/3)]">
              <figure
                className={`relative flex h-full flex-col overflow-hidden rounded-[20px] p-7 pt-14 shadow-[0_12px_30px_-18px_rgba(43,37,32,0.45)] sm:p-9 sm:pt-16 ${
                  featured ? "bg-accent text-white" : "border border-oak bg-background text-neutral-900"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute left-6 top-0 select-none font-display text-[7rem] leading-none sm:left-8 ${
                    featured ? "text-white/25" : "text-cinnamon/30"
                  }`}
                >
                  &ldquo;
                </span>
                <blockquote className="font-display text-xl leading-snug sm:text-2xl">
                  <p>{review.quote}</p>
                </blockquote>
                <figcaption className="mt-7 flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className={`flex h-11 w-11 items-center justify-center rounded-[999px] text-lg font-semibold ${
                      featured ? "bg-background text-accent" : "bg-accent text-white"
                    }`}
                  >
                    {review.author.replace(/^Gæstens\s+/i, "").charAt(0).toUpperCase()}
                  </span>
                  <span className={`font-medium ${featured ? "text-white" : "text-neutral-800"}`}>{review.author}</span>
                </figcaption>
              </figure>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
