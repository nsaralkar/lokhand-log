# fitness-data (example)

This directory is the SHAPE of your private data repo. To create yours:

    cp -r data-example /path/to/fitness-data
    cd /path/to/fitness-data && git init && git add -A && git commit -m init
    git remote add backup <your-local-remote>   # see docs/DEPLOY.md

All contents here are FAKE demo data (user: demo / password: demo).
Never commit real data to the public lokhand-log repo.

All units are native imperial (lb, in, mi) — no conversion happens anywhere.

Layout:
  config/users.yaml           auth (bcrypt hashes) + display names
  shared/exercises.yaml       canonical exercise library (shared by all users)
  shared/routines/*.yaml      routines: each a program with multiple days of blocks
  users/<name>/workouts/      monthly JSONL: sets, cardio, session markers
  users/<name>/metrics/       monthly JSONL: weight, dimensions
