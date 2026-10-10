# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository. Include steps to reproduce and the
version (commit) you tested. You should get a reply within a week.

## Keeping your own deployment safe

- Never commit `.env`, API keys, or the `data/` folder. They are listed in `.gitignore`; keep it that way.
- Set `ALLOWED_DOMAINS` to your own domain only, set `PUBLIC_URL` to your `https://` address, and run behind HTTPS.
- Keep the SMTP password and the GitHub client secret in `.env` only; rotate them if they leak.
- If an Anthropic API key, SMTP password or GitHub client secret is ever exposed, revoke it immediately and create a new one.
- Back up `data/mdshare.sqlite` regularly; there is no version history yet.

See the **Security** section of the README for what Labbook protects against today and its known limits.
