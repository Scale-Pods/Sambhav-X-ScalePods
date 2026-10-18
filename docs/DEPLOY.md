# Putting the front end on Vercel

## Vercel project
- Import the GitHub repo. **Root Directory: `web`**. Framework: Next.js (detected). Build and start commands: defaults.
- Project name: `sambhav-stock` (gives https://sambhav-stock.vercel.app). Later, for staff to bookmark: `stock.sambhavpipes.com` (needs a CNAME at the client's DNS).

## Environment variables (Vercel > Settings > Environment Variables, Production and Preview)
| Name | Value |
|---|---|
| `DATABASE_URL` | Supabase > Connect > **Transaction pooler** string (port **6543**) with the database password filled in |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://oydcmbnpfyhqsdwmcyrm.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the `sb_publishable_...` key (Supabase > Settings > API Keys). It is a public key and safe in the browser. |

`DATABASE_URL` is secret: mark it Sensitive. Never put it in a `NEXT_PUBLIC_` variable.

## Supabase settings (Authentication)
1. Sign In / Providers: turn **off** "Allow new users to sign up". Accounts are created by an administrator only.
2. URL Configuration: Site URL = the Vercel address.
3. Passwords: minimum length 10.
4. Users > Add user > create each person with their work email and "Auto Confirm". On creation the database links the login to the staff row with the same email (migration 11). A login with no staff row sees no data.

## How the data is protected
- Every page and every save checks the signed-in user, then runs the query as that user inside the database (`set local role authenticated`), so the row-level security rules decide what they see.
- The app role has read-only table access. Every save goes through a checked function (`record_count_line`, `resolve_exception`, `start_count_session`, `close_count_session`, `reject_count_line`) that tests the person's role.
- `robots: noindex` is set. Add Vercel Deployment Protection on preview URLs.
