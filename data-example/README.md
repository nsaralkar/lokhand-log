# fitness-data (example)

This directory is the SHAPE of your private data repo. To create yours:

    cp -r data-example /path/to/fitness-data
    cd /path/to/fitness-data && git init && git add -A && git commit -m init
    git remote add backup <your-local-remote>   # see docs/DEPLOY.md

All contents here are FAKE demo data (user: demo / password: demo).
Never commit real data to the public fitness-app repo.

Layout:
  config/users.yaml           auth (bcrypt hashes) + per-user display units
  shared/exercises.yaml       canonical exercise library (shared by all users)
  users/<name>/workouts/      monthly JSONL: sets, cardio, session markers
  users/<name>/metrics/       monthly JSONL: weight, dimensions
  users/<name>/templates/     saved workouts (YAML): straight sets, supersets, circuits
