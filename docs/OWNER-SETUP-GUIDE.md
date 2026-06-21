# BYB Platform — Owner Setup Guide (Going Live)

This guide takes you from "the code is finished" to "the app is running on the
internet." It's written in plain English. You do **not** need to understand the
code — just follow the steps in order.

Set aside about **45–60 minutes**. If you get stuck on Part A (the database), that
part is the most technical — it's fine to hand just that part to a developer.

---

## What you're setting up (the big picture)

Your app has **three pieces** that all need to be online and pointed at each other:

| Piece | What it does | Where it lives |
|-------|--------------|----------------|
| **Database & login** | Stores all data; handles sign-in | **Supabase** (a hosted service) |
| **API (the "server")** | The brains — rules, onboarding, etc. | **Railway** (a hosting service) |
| **Website (the "web app")** | What people see and click | **Railway** |

Think of it like a restaurant: Supabase is the **pantry**, the API is the
**kitchen**, and the website is the **dining room**. All three have to be open,
and the kitchen needs to know where the pantry is, etc. The steps below just wire
those connections.

You'll do them in this order: **Supabase → API → Website → connect them → test.**

---

## Before you start — accounts you need

1. **GitHub** — already done. Your code lives at `github.com/QEbellavita/BYB`.
2. **Supabase account** — free to start: https://supabase.com → "Start your project."
3. **Railway account** — free to start: https://railway.com → sign up with GitHub.

You'll also need the **Supabase CLI** for Part A (a small tool that loads your
database structure). Install it once:

- **Mac:** open the Terminal app and run `brew install supabase/tap/supabase`
- **Windows:** run `scoop install supabase` (or see https://supabase.com/docs/guides/cli)

(If you're not comfortable in the Terminal, this is the one part worth handing to
a developer — it's ~5 commands.)

---

## Part A — Set up the database (Supabase)

This creates your real, online database and loads the structure the app expects.

1. Go to https://supabase.com/dashboard → **New project**.
   - Give it a name (e.g. `byb-production`).
   - Set a **database password** and **save it somewhere safe** (you'll rarely
     need it, but don't lose it).
   - Pick a region close to your users (e.g. Sydney for AU/NZ).
   - Click **Create new project** and wait ~2 minutes for it to finish.

2. **Load the database structure.** In your Terminal, go to the project folder and
   run these (replace `<PROJECT-REF>` — see note below):

   ```bash
   supabase login
   supabase link --project-ref <PROJECT-REF>
   supabase db push
   ```

   - **Where to find `<PROJECT-REF>`:** in the Supabase dashboard, open your
     project → **Project Settings** → **General** → "Reference ID" (a short code
     like `abcdefghijklmnop`).
   - `supabase db push` will ask for the database password from step 1.
   - When it finishes, your online database has all the tables, security rules,
     and onboarding logic. ✅

3. **Copy three keys** — you'll paste these into Railway later. In the Supabase
   dashboard: **Project Settings → API**. Copy and label these somewhere:

   | Label it | Where to find it |
   |----------|------------------|
   | **Project URL** | "Project URL" (looks like `https://abcd….supabase.co`) |
   | **anon key** | under "Project API keys" → `anon` `public` |
   | **service_role key** | under "Project API keys" → `service_role` (click "Reveal") |

   ⚠️ The **service_role key is a master key** — treat it like a password. It goes
   only into the API server settings, never into the website.

4. **Tell Supabase your website address.** You don't have it yet — come back to
   this after Part C. (It's: Project Settings → **Authentication → URL
   Configuration** → set "Site URL" to your website's address.)

---

## Part B — Deploy the API (the server) on Railway

1. Go to https://railway.com → **New Project** → **Deploy from GitHub repo** →
   choose **`QEbellavita/BYB`**. Authorize Railway to access the repo if asked.

2. Railway creates a service. Open it → **Settings**:
   - **Root Directory:** leave it as the repository root (blank / `/`).
   - **Config file path / "Railway config file":** set it to **`server/railway.json`**.
     (This tells Railway to build and run the API, not the website.)
   - Rename the service to something clear like **`byb-api`**.

3. Open the service → **Variables** → add these four (from Part A step 3):

   | Variable name | Value |
   |---------------|-------|
   | `SUPABASE_URL` | your **Project URL** |
   | `SUPABASE_ANON_KEY` | your **anon key** |
   | `SUPABASE_SERVICE_ROLE_KEY` | your **service_role key** |
   | `CORS_ORIGIN` | leave blank for now — you'll set it in Part C |

   (Don't set `PORT` — Railway sets it automatically.)

4. Let it deploy. When it's done, Railway shows a public URL under
   **Settings → Networking → Public Networking** (looks like
   `https://byb-api-production.up.railway.app`). If there isn't one, click
   **Generate Domain**. **Copy this URL — this is your API address.**

5. Quick check: open `<your API URL>/health` in a browser. You should see
   `{"status":"ok"}`. ✅

---

## Part C — Deploy the website on Railway

1. In the **same Railway project**, click **New** → **GitHub Repo** → choose
   **`QEbellavita/BYB`** again (yes, the same repo — it's a second service).

2. Open the new service → **Settings**:
   - **Root Directory:** repository root (blank / `/`).
   - **Config file path:** set it to **`railway.json`** (the one at the top level —
     this builds the website).
   - Rename it to something like **`byb-web`**.

3. Open the service → **Variables** → add these three:

   | Variable name | Value |
   |---------------|-------|
   | `VITE_SUPABASE_URL` | your **Project URL** (same as the API's) |
   | `VITE_SUPABASE_ANON_KEY` | your **anon key** (same as the API's) |
   | `VITE_API_URL` | your **API address** from Part B step 4 |

4. Let it deploy, then get its public URL (**Settings → Networking**, generate a
   domain if needed). **This is your website address** — the link you give people.

---

## Part D — Connect the three pieces

Now that all the addresses exist, fill in the two connections you left blank:

1. **API → website (allow the browser calls):** go to the **`byb-api`** service →
   **Variables** → set `CORS_ORIGIN` to your **website address** from Part C
   (e.g. `https://byb-web-production.up.railway.app`). Save — Railway redeploys.

2. **Supabase → website (allow sign-in):** go back to Supabase → **Project
   Settings → Authentication → URL Configuration** → set **Site URL** to your
   website address. Save.

> ℹ️ The website's three `VITE_…` values are baked in **when it builds**. If you
> ever change them, click **Deploy / Redeploy** on the `byb-web` service so they
> take effect.

---

## Part E — Test that it works

1. Open your **website address** in a browser. You should see the BYB landing page.
2. Click **Sign in**, enter your email, and request a code.
3. Check your email for the one-time code (see the note about email below — until
   real email is set up, codes come through Supabase's built-in email, which is
   fine for testing but limited).
4. Sign in → you should land in the **onboarding wizard**, create a workspace, and
   walk through the steps.

If sign-in or data loading fails, see Troubleshooting below.

---

## Automatic updates (recommended)

Both Railway services are connected to your GitHub repo. By default, **every time
new code is merged into the `main` branch, Railway will rebuild and redeploy
automatically.** You don't have to do anything. (You can confirm/turn this on per
service under **Settings → "Deploy on push" / source branch = `main`**.)

---

## Before you invite real customers

A few things are intentionally left for when you're ready to go fully live:

- **Real email sending.** Right now invitation emails are written to a log, not
  actually sent (and sign-in codes use Supabase's basic built-in email). Before
  inviting real users, set up a proper email sender (e.g. Resend, Postmark, or
  SendGrid) in Supabase's Auth settings and for invite delivery. Ask your
  developer to "wire a real email transport."
- **Your own web address.** Railway gives you a `*.up.railway.app` address. To use
  your own domain (e.g. `app.yourbusiness.com.au`), add it under the `byb-web`
  service → **Settings → Networking → Custom Domain**, then update the API's
  `CORS_ORIGIN` and Supabase's Site URL to match.
- **Backups & plan limits.** The free tiers are great for launch; check Supabase
  and Railway plans before you depend on it for real business data.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|--------|--------------|-----|
| Website loads but **sign-in does nothing / errors** | `VITE_API_URL` wrong, or `CORS_ORIGIN` not set to the website address | Re-check Part C step 3 and Part D step 1; redeploy the website after changing `VITE_…` values |
| **"permission denied" / data won't load** after sign-in | Database structure not applied | Re-run `supabase db push` (Part A step 2) |
| API `/health` doesn't return `{"status":"ok"}` | API env vars missing, or wrong config path | Check `byb-api` has all three Supabase variables and config path = `server/railway.json` |
| Sign-in email never arrives | Supabase built-in email is rate-limited | Fine for light testing; set up real email (see "Before you invite real customers") |
| Changes to website settings don't show up | `VITE_…` values are baked in at build time | Redeploy the `byb-web` service |

---

## Quick reference — who needs which values

| Value (from Supabase) | byb-api (server) | byb-web (website) |
|-----------------------|:----------------:|:-----------------:|
| Project URL | `SUPABASE_URL` | `VITE_SUPABASE_URL` |
| anon key | `SUPABASE_ANON_KEY` | `VITE_SUPABASE_ANON_KEY` |
| service_role key | `SUPABASE_SERVICE_ROLE_KEY` | ❌ never |
| API address | — | `VITE_API_URL` |
| Website address | `CORS_ORIGIN` | — |

That's everything. Once Parts A–D are done and Part E checks out, your platform is
live. 🎉
