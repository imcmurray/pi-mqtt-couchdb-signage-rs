#!/bin/bash

# Update version across all components
# Usage: ./scripts/update-version.sh 0.2.0

if [ -z "$1" ]; then
    echo "Usage: $0 <version>"
    echo "Example: $0 0.2.0"
    exit 1
fi

VERSION=$1

echo "Updating version to $VERSION..."

# Update package.json
npm version $VERSION --no-git-tag-version

# Update Rust Cargo.toml
sed -i "s/^version = \".*\"/version = \"$VERSION\"/" pi-slideshow-rs/Cargo.toml

# Update UI version display
sed -i "s/this.updateVersionDisplay('.*')/this.updateVersionDisplay('$VERSION')/" public/js/app.js

echo "Version updated to $VERSION in all components"
echo "Next steps:"
echo "1. Review changes: git diff"
echo "2. Commit: git add -A && git commit -m 'Bump version to $VERSION'"
echo "3. Tag: git tag -a v$VERSION -m 'Release v$VERSION'"
echo "4. Push: git push origin main && git push origin v$VERSION"