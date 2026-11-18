# Image Catalog

Every image in `public/images/`, where it came from and what it may be used for. Café Lærke is
fictional (see `brand.md`), so there are no client photos: every picture is a CC0 photo with no
people in it, except the front-page hero, which was made with AI. A real client's own photos would replace these one for one.

CC0 needs no credit, but the footer says "Billeder: CC0 fra Wikimedia Commons og rawpixel." anyway, and the
sources stay listed here. Only `hero/bageri-cafe-morgen.webp` is made with AI; it carries no visible "made with AI" note unless the owner asks for one.

| File | Shows | Used on | Source | Licence | Provenance | Edits |
|---|---|---|---|---|---|---|
| `hero/bageri-cafe-morgen.webp` | Bright bakery café with two arched windows, a dark green bench, oak tables with a coffee cup, a glass counter with cinnamon buns and pastries and a rack of sourdough loaves | Forside hero | Made with AI image generation at the owner's request | — | ai-generated | None (kept unchanged so the file keeps its AI provenance marks) |
| `services/morgenmad.jpg` | Breakfast table: toast with berries, coffee, bowl of fruit | Forside "Morgenmad", Menu | [Breakfast at Dawn (Unsplash)](https://commons.wikimedia.org/wiki/File:Breakfast_at_Dawn_(Unsplash).jpg), Wikimedia Commons | CC0 | stock | Resized to 1600 px |
| `services/kage-og-kaffe.jpg` | Slice of crumb cake on paper beside a cappuccino | Forside "Kage og kaffe" | [Coffee and coffee cake (Unsplash)](https://commons.wikimedia.org/wiki/File:Coffee_and_coffee_cake_(Unsplash).jpg), Wikimedia Commons | CC0 | stock | Resized to 1600 px |
| `services/frokost.jpg` | Toasted sandwich with egg, ham, cheese and tomato | Forside "Frokost" | [Breakfast (Unsplash)](https://commons.wikimedia.org/wiki/File:Breakfast_(Unsplash).jpg), Wikimedia Commons | CC0 | stock | Resized to 1600 px |
| `services/kanelsnegle.jpg` | Tray of freshly baked cinnamon swirls | Forside weekend band | [Free cinnamon rolls image](https://www.rawpixel.com/image/5913829/image-public-domain-food-free), rawpixel | CC0 | stock | Converted to JPEG (1024 px, the largest free size) |
| `facility/kaffe.jpg` | Cup of frothy coffee with cinnamon and a spoon | Om os | [Frothy coffee (Unsplash)](https://commons.wikimedia.org/wiki/File:Frothy_coffee_(Unsplash).jpg), Wikimedia Commons | CC0 | stock | Resized to 1600 px |

Rules for new images (kit image rules): no people in stock or generated pictures; one row here per
file; long edge at most 2000 px and under 1000 KB (`npm run images` checks); a generated picture
that could pass as a real photo gets the line from the legal-compliance skill before launch.
