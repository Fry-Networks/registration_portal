# Docker Dev Mode for user-dashboard

## Overview
The production `docker-compose.yml` builds a release image and runs `npm start`. For iteration that is slow: every code change requires a full rebuild and Next.js cannot hot reload inside the production container. This doc explains how to launch a dev-only stack that:
- mounts the working tree into the container;
- runs `npm run dev` with hot reload; and
- keeps the live production stack untouched.

## Files Added
- `docker-compose.dev.yml` — compose override enabling dev behavior.
- `docs/dev-mode.md` — this guide.

## Starting the Dev Stack
1. Connect to the VPS (if not already). Keep your production stack running.
2. Launch the dev override (just the dashboard service) from the project root. Give it its own project name so it never collides with production:
   `docker compose -f docker-compose.yml -f docker-compose.dev.yml -p user-dashboard-dev up --build fry-dashboard-users`

   - Use `--build` the first time (or when you change Dockerfile / dependencies) so the image reflects your latest setup.
   - For normal code edits, skip the rebuild step and run:
     `docker compose -f docker-compose.yml -f docker-compose.dev.yml -p user-dashboard-dev up fry-dashboard-users`
     This reuses the cached image; Next.js hot reload handles source changes instantly.
   - The override switches `fry-dashboard-users` to `npm run dev` and exposes port `3007`.

### Stopping Dev Mode
Press `Ctrl-C` in the terminal running dev mode, or remove the dev containers explicitly:
`docker compose -f docker-compose.yml -f docker-compose.dev.yml -p user-dashboard-dev down`

## Accessing the Dev Server
Because the VPS hosts the live site and you do not browse locally, tunnel the dev port:
1. From your laptop, create an SSH tunnel to the VPS (replace `portnumber` if you use a non-default SSH port):
   `ssh -L 4007:localhost:4007 -p portnumber user@your-vps-host`
2. In the tunneled session, run the dev stack as above.
3. Visit `http://localhost:4007` in your local browser to see the dev server (the container listens on 3007 internally; the SSH tunnel handles 4007 externally).
4. Need to run prod and dev concurrently? Start prod normally (`docker compose up -d fry-dashboard-users`) and start dev with the `-p user-dashboard-dev` name; the containers (`fry-user-dashboard` vs `fry-user-dashboard-dev`) stay isolated.

Alternative options:
- Configure a private dev subdomain via the reverse proxy (add basic auth).
- Use VS Code Remote / JetBrains Gateway port forwarding if you prefer IDE integration.

## Environment Notes
- The dev override sets `NEXT_PUBLIC_TEST_MODE=true` so test collections are used by default. `NEXT_PUBLIC_DEV_MODE` is left `false` unless you supply `NEXT_PUBLIC_ALGORAND_DEV_MNEMONIC` and want the stub dev wallet experience.
- It reuses the same `.env` as production (through the base compose file). Provide a `.env.dev` if you want isolated credentials and reference it with `env_file` in the override.

## Switching Between Prod and Dev
- Production stack: `docker compose up -d` (no dev override).
- Dev stack: include the override file and omit `-d` so logs stream to your terminal.
- Both stacks share image layers, so switching is fast.

## After Making Changes
1. Confirm behavior in dev mode.
2. Stop the dev stack.
3. Rebuild the production image when ready:
   `docker compose build fry-dashboard-users`
   `docker compose up -d fry-dashboard-users`
4. Run the existing `scripts/check-vault.js` or other diagnostics as needed.
