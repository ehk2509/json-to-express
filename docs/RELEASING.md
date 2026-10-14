# Releasing json-to-express

## Public beta v0.2.0-beta.1

1. Merge the release PR only when all CI jobs, including `packaged-install-e2e`, pass.
2. The `Publish beta` workflow runs after the successful **push** CI run on `main`. It creates a prerelease GitHub Release and tag `v0.2.0-beta.1`, idempotently. It does not publish a tag from untrusted PR code.
3. GitHub tag installation works without npm access: `npm install -g github:ehk2509/json-to-express#v0.2.0-beta.1`.
4. npm publication is optional and separately gated on the repository secret `NPM_TOKEN`. The token must be authorized to publish the `json-to-express` package. The workflow uses the `beta` npm dist-tag and provenance attestations. Do not claim npm publication until the job and registry can be verified.
5. If npm publication is skipped, configure `NPM_TOKEN` and publish the exact reviewed tag in an authorized environment (`npm publish --tag beta --access public --provenance`), or set up npm Trusted Publishing after a first publication. Never expose the token.
6. Verify: `npm view json-to-express@beta version`, `npm install -g json-to-express@beta`, `j2e --version`.

## Future releases

Choose a new version, update `package.json` and `CHANGELOG.md`, add corresponding notes and update the guarded release workflow. Run `npm test`, `npm run check`, `npm run validate:examples`, and `npm run test:package`. Keep tags immutable, avoid overwriting already published versions, and use prerelease dist-tags until a stable release is justified.
