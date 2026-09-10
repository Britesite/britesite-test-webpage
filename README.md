# Britesite Test

Permanent test website for the deployed Britesite application. All content is
synthetic. It has its own repository and hosting; no customer website belongs
to this test workflow.

Run `npm run dev`, `npm run check` and `npm run build` using Node 22 or newer.
The homepage is `src/app/[locale]/page.tsx`; its main test paragraph starts at
18px (`text-lg`). Use that paragraph for the first selection and Undo check.

Preview deployments may enable the existing selection bridge with
`WEBSITE_AGENT_ORIGIN=https://app.britesite.dk`. Production deployments keep
framing and the bridge disabled. Search indexing and analytics are disabled.
No contact-delivery or payment credentials are required.

Keep account credentials, claim links and test-user email addresses out of this
repository. Only the test website may be edited or published during verification.
