# QvantCom AI staging boundary

The Netlify function `/.netlify/functions/ai` is the only allowed browser-to-runtime path.
It validates the caller's Supabase access token server-side and constructs the complete
runtime scope itself. Browser fields cannot select another product, organisation, model,
tool or document namespace.

Required staging-only Netlify environment variables:

- `HAVELO_SUPABASE_URL`
- `HAVELO_SUPABASE_ANON_KEY`
- `HAVELO_STAGING_ORGANISATION_ID=org-havelo-staging`
- `QVANTCOM_RUNTIME_CLIENT_ID` (Havelo service token only)
- `QVANTCOM_RUNTIME_CLIENT_SECRET` (Havelo service token only)

These values must never be committed or exposed to client-side JavaScript. Production
remains unchanged until a separate review and approval.
