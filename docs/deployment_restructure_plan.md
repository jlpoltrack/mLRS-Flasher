# CI/CD Deployment Separation
Date: 2026-01-16

Divide the deployment workflows to clearly separate the Development environment (GitHub Pages) from the Production environment (FTP).

## Proposed Changes

Currently, both `ftp-deploy.yml` and `gh-pages-deploy.yml` trigger on multiple branches, including the legacy `master` branch. We will standardize on `main` as the production branch and `web` as the development branch.

### [Branch Standardization]

- **Main Branch**: Standardize on `main` for production.
- **Master Branch**: Remove all references to `master` in workflows and delete the branch from the `JLP` remote if no longer needed.
- **Web Branch**: Continue using `web` for development/staging (GitHub Pages).

---

### [GitHub Actions Workflows]

#### [MODIFY] [ftp-deploy.yml](file:///Users/jlp/Documents/mLRS-Flasher/.github/workflows/ftp-deploy.yml)
- Restrict `push` trigger to `main` only.
- Remove `web` from triggers (it should only deploy to dev).
- Add an `environment` field for `prod`.

#### [MODIFY] [gh-pages-deploy.yml](file:///Users/jlp/Documents/mLRS-Flasher/.github/workflows/gh-pages-deploy.yml)
- Restrict `push` trigger to `web` only.
- Remove `main` and `master` from triggers.
- Add/clarify `environment: github-pages`.

## Alternatives Considered

### Unified Deployment Workflow
We could merge both into a single `deploy.yml` file with separate jobs. This is cleaner as it centralizes all deployment logic, but keeping them separate as they are now is also perfectly fine if you prefer one file per target. 

I recommend **restricting the branches** first as it's the most critical fix.

## Verification Plan

### Manual Verification
- Push a change to the `web` branch and verify that ONLY the "Deploy to GitHub Pages" action triggers.
- Push a change to the `main` branch and verify that ONLY the "Deploy to FTP" action triggers.
- Manually trigger each workflow via the "Actions" tab to ensure `workflow_dispatch` still works.
