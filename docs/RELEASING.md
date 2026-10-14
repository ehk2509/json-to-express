# Releasing json-to-express

## v0.2.0-beta.1 GitHub release

- PR #42 merged and 16 CI jobs passed. GitHub prerelease and immutable version tag: https://github.com/ehk2509/json-to-express/releases/tag/v0.2.0-beta.1
- GitHub installation without npm: `npm install -g github:ehk2509/json-to-express#v0.2.0-beta.1`.
- npm publication from the original workflow was rejected with HTTP 403 because the npm token lacked appropriate two-factor publishing authorization. The npm package's first publication therefore remains a separate bootstrap step.

## One-time npm registry bootstrap (maintainer action)

**npm Trusted Publishers cannot be configured for a package that does not yet exist on the registry.** If `json-to-express` has never been published, its owner must make one interactive publication first, with 2FA, from the exact reviewed release tag:

```bash
git clone https://github.com/ehk2509/json-to-express.git
cd json-to-express
git checkout v0.2.0-beta.1
npm login
npm pack --dry-run
npm publish --tag beta --access public
npm view json-to-express@beta version
```

**Important:** confirm `npm view json-to-express` and that you control the exact unscoped package name before publishing. Do not publish over an unrelated owner's package. The interactive npm login/publish runs on the maintainer's machine; never place a personal npm token in the repository or in logs.

## Enable GitHub Actions OIDC Trusted Publishing

Once the npm package is under your ownership:

1. In the npm package's **Settings → Trusted publishing**, add **GitHub Actions** using the following exact values:
   - Owner/user: `ehk2509`
   - Repository: `json-to-express`
   - Workflow filename: `publish-beta.yml` (filename only; not the whole path)
   - Environment: leave empty (this workflow does not declare one)
   - Allowed actions: **allow `npm publish`** (since September 2026, `npm stage publish` is allowed by default; direct publication needs its own permission).
2. In the GitHub repository **Settings → Secrets and variables → Actions → Variables**, create `NPM_TRUSTED_PUBLISHING_ENABLED` with value `true`. The npm job is skipped until this opt-in is enabled.
3. The workflow's `npm-beta` job uses GitHub-hosted runners, Node.js 24, `id-token: write`, and npm >= 11.5.1, without `NPM_TOKEN` or `NODE_AUTH_TOKEN`. On the next suitable successful CI push to `main`, it publishes the exact reviewed beta tag if the version is not already in npm. As `v0.2.0-beta.1` is already on GitHub, the existing version is not overwritten.
4. Inspect the workflow result and registry before announcing npm availability: `npm view json-to-express@beta version`; `npm install -g json-to-express@beta`; `j2e --version`.
5. Once OIDC publication succeeds, revoke unused publishing tokens on npm and delete the obsolete `NPM_TOKEN` GitHub secret. Optionally set npm publishing access to **require 2FA and disallow tokens**, without affecting Trusted Publishing.

A newly configured trusted publisher must complete a successful publish within two days or it expires. Configure it shortly before the **next new version** and check that a successful publish occurs. OIDC authentication does not make an existing version publishable again.

## Future releases

Choose a new version, update `package.json`, `CHANGELOG.md`, release notes, and update the version/tag guards in `.github/workflows/publish-beta.yml`. Test `npm test`, `npm run check`, `npm run validate:examples`, and `npm run test:package`. Merge when CI passes. The workflow automatically creates the GitHub prerelease from successful push-to-main CI and, once `NPM_TRUSTED_PUBLISHING_ENABLED` is set, publishes via OIDC.

Keep tags immutable, never overwrite npm versions, and use beta dist-tags until stability criteria are met. If using `workflow_dispatch` or reusable workflows in future, verify npm's exact GitHub workflow identity validation before changing the trusted publisher entry.

References: https://docs.npmjs.com/trusted-publishers/ and https://docs.npmjs.com/cli/v11/commands/npm-trust/
