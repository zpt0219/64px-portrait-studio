# Development Guidelines & Rules

## Testing Policy
- **Always run both Unit and E2E tests together**:
  - Whenever asked to run tests, or validating code changes before completion, always run `npm test` (which executes both Vitest unit/integration tests and Playwright E2E tests).
  - Do not skip E2E tests unless explicitly requested by the user.

## Build & Deployment
- After pulling code or making approved modifications, run `npm run build` and sync the production assets to `/var/www/adna/64px-portrait-studio/` with `www-data:www-data` permissions:
  ```bash
  npm run build && sudo rsync -a --delete dist/ /var/www/adna/64px-portrait-studio/ && sudo chown -R www-data:www-data /var/www/adna/64px-portrait-studio/
  ```
