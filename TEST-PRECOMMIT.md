# Pre-commit Hook Test

This file tests that the new pre-commit hook automatically:
1. Updates src/version.json
2. Stages version.json and package.json
3. Includes them in the commit

If successful, version.json should be included in this commit without manual staging.
