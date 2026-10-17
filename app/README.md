# Editor (PWA)

Personal video editor that runs in Safari on the iPhone and installs to the
home screen. Everything happens on the device; there is no server.

```bash
npm install
npm run dev        # http://localhost:5173, design system at #/design
npx vitest run     # unit tests
npm run build      # static site in dist/
```

## Deploy on Cloudflare Pages

The site is static, so any HTTPS host works. On Cloudflare Pages:

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git**, and pick this repository.
2. Build settings:

   | setting | value |
   | --- | --- |
   | Production branch | the branch that has `app/` (today `claude/install-replica-skill-j5q2ux`; `main` once merged) |
   | Framework preset | None |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
   | Root directory (advanced) | `app` |

   Node comes from `app/.node-version` (22). The build reads
   `../replica/design/tokens.json`, which Pages has because it clones the
   whole repository.
3. **Save and Deploy.** Every push to that branch publishes a new version;
   other branches get preview links.

`public/_headers` keeps `sw.js` and `index.html` uncached so updates reach the
installed app; the hashed files in `assets/` are cached for a year.

## Install on the iPhone

Open the `*.pages.dev` link in **Safari** → Share → **Add to Home Screen**.
Open it from the home screen icon (not from Safari) so it runs full screen
and keeps its storage.
