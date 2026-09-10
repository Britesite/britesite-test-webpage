# Site guide

- Framework: Next.js, TypeScript, Tailwind, next-intl. Locale: en.
- Homepage: /en, implemented in src/app/[locale]/page.tsx.
- Main test paragraph: "This paragraph is a safe place to test font-size changes."
- Baseline paragraph: text-lg, rendered at 18px.
- Shared layout: src/app/[locale]/layout.tsx.
- Styles: src/app/globals.css.
- Messages and metadata: messages/en.json.
- No configured contact delivery, payment provider or analytics.
- Selection is enabled only in hosted previews with WEBSITE_AGENT_ORIGIN.

Update this guide when pages or navigation change.
