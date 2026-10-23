# GENFEST IKMAB-K Ticketing — Netlify + Supabase + Xendit

This edition does **not** use Render. The frontend and API run on Netlify; PostgreSQL runs on Supabase; hosted payment invoices use Xendit.

## Important status
This is deployment-ready source structure, not a claim that the live service has been tested. You must configure accounts/secrets and test the full flow before selling real tickets. Xendit Live access depends on account approval/activation. Netlify Functions have execution/runtime limits; verify current plan limits before event day.

## 1. Supabase database
1. Create a dedicated Supabase project.
2. In SQL Editor, run the complete `schema.sql` file once.
3. Copy the PostgreSQL connection string from Supabase. Prefer the Session Pooler connection for serverless functions if direct connections are not reachable; URL-encode special characters in the password.

## 2. Deploy to Netlify
1. Upload the project folder to a GitHub repository, with `netlify.toml`, `package.json`, `server.js`, `schema.sql`, and `public/` at the repository root.
2. In Netlify choose **Add new site → Import an existing project**, select the repository, then deploy. `netlify.toml` sets `public` as publish directory and `netlify/functions` as functions directory.
3. In Netlify site settings, open **Environment variables** and add these server-side variables:
   - `DATABASE_URL` = Supabase PostgreSQL URI
   - `PG_SSL` = `true`
   - `FRONTEND_URL` = your exact Netlify site origin, e.g. `https://your-site.netlify.app`
   - `XENDIT_SECRET_KEY` = Xendit secret API key (test key for testing, live key only after approval)
   - `XENDIT_CALLBACK_TOKEN` = the callback verification token configured in Xendit; use a long random secret
   - `ADMIN_KEY` = a random secret at least 32 characters long
   - `TICKET_PRICE` = `130000` (change if needed)
   - `TICKET_LIMIT` = `200` (change if needed)
   - `EVENT_NAME` = `GENFEST IKMAB-K 2026 - FUN RUN`
   - `EVENT_DATE` = `15 November 2026`
   - `EVENT_LOCATION` = `Area Kampus 2 UIN K.H. Abdurrahman Wahid Pekalongan`
4. Trigger a new deploy after adding environment variables.

Do **not** put any secret keys, callback token, database URI, or admin key in `public/config.js`, frontend files, screenshots, or GitHub.

## 3. Configure Xendit webhook
In the Xendit dashboard, configure the invoice/payment notification callback URL to:
`https://YOUR-NETLIFY-SITE.netlify.app/api/payment-notification`
Set the callback verification token to the same value as `XENDIT_CALLBACK_TOKEN`. Ensure invoice notifications are enabled.

## 4. Test before live use
- Open `https://YOUR-NETLIFY-SITE.netlify.app/api/health` — expect JSON `{ "ok": true }`.
- Check `https://YOUR-NETLIFY-SITE.netlify.app/api/config` — it should return event configuration and a sold count.
- Test invoice creation using Xendit test credentials and a supported test flow.
- Confirm webhook marks an order paid and creates one unique ticket per ticket quantity.
- Test admin dashboard and QR check-in. Verify duplicate check-in is rejected.
- Only after all tests pass and Xendit Live is activated, set the live secret key and use real payment methods.

## Routes
- `GET /api/health`
- `GET /api/config`
- `POST /api/create-order`
- `POST /api/payment-notification` (Xendit webhook)
- `GET /api/order/:orderId`
- `GET /api/admin/orders` (Bearer `ADMIN_KEY`)
- `POST /api/admin/checkin` (Bearer `ADMIN_KEY`)

## Security notes
- Rotate any database password that has been shared in chat or committed to a repository.
- Admin access currently uses one shared `ADMIN_KEY`, not individual accounts. Share it only with trusted organizers.
- QR check-in requires a secure HTTPS origin and camera permission.
- A redirect to the success page does not prove payment; the verified Xendit webhook is the source of truth.
- Do not use this for real sales until the end-to-end test is successful.
