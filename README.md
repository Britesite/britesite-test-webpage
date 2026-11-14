# Britesite Test — Café Lærke

Permanent test and demo website for the deployed Britesite application (the editing helper).
It is dressed as **Café Lærke**, a made-up neighbourhood café in Odense, so the helper can be tried
and shown on something that looks like a real small-business site. The business, its address,
phone number, menu and prices are all invented; a strip at the top of every page says so. No
customer website belongs to this test workflow, and it has its own repository and hosting.

The site was built the way a client site is built: scaffolded from the website-redesign-kit
template with `setup-website.sh`, `brand.md` drafted by the kit's intake step from a hand-filled
intake, then `design-direction.md`, the tokens in `src/app/globals.css`, `design-system.md` and the
pages. Pictures are CC0 photos without people, listed in `public/images/IMAGE_CATALOG.md`.

Run `npm run dev`, `npm run check` and `npm run build` using Node 22 or newer (npm 11 for installs).

Good first things to try in the helper:

- the homepage lead paragraph (`home.lead`, 18px on phones, 20px from `sm`) for a selection,
  font-size and Undo check;
- opening hours (`info.hours` in `messages/da.json`, shown on the homepage, the contact page and in
  the footer);
- a dish or a price on the menu (`menu.sections` in `messages/da/_routes/menu.json`; a new dish
  also needs its key in `src/app/[locale]/menu/page.tsx`);
- swapping a picture (see `public/images/IMAGE_CATALOG.md`).

Preview deployments may enable the existing selection bridge with
`WEBSITE_AGENT_ORIGIN=https://app.britesite.dk`. Production deployments keep framing and the
bridge disabled. The site lives only on `*.vercel.app`, where the proxy sends
`X-Robots-Tag: noindex`, so it is never indexed. It has no analytics and no contact form, so no
contact-delivery or payment credentials are required.

Keep account credentials, claim links and test-user email addresses out of this repository. Only
the test website may be edited or published during verification.
