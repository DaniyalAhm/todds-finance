# Docker deployment

The service-specific container definitions are in `dockerfiles/`:

- `frontend.Dockerfile` — Next.js web frontend
- `backend.Dockerfile` — Express API backend
- `ml-backend.Dockerfile` — Flask/Splink entity-resolution backend

Copy the example environment and set at least `ACTUAL_PASSWORD`:

```bash
cp .env.docker.example .env
docker compose up --build -d
```

Services are exposed at:

- Frontend: `http://localhost:3000`
- Express API: `http://localhost:3010`
- ML API: `http://localhost:5000`

Follow logs with `docker compose logs -f` and stop the stack with
`docker compose down`. Backend configuration and the Actual Budget cache are
stored in named volumes. Running `docker compose down -v` also deletes that
persisted data.

`PUBLIC_BACKEND_URL` is embedded in the browser bundle during the frontend
image build. Set it to a URL reachable from users' browsers when deploying to
a host other than localhost, then rebuild the frontend image.
