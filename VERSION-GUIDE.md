# Version Management Guide

This guide explains how to update versions across all components of the Digital Signage Management System.

## Quick Version Update

**Automated (Recommended):**
```bash
./scripts/update-version.sh 0.2.0
```

**Manual Process:**
1. Update `package.json` version
2. Update `pi-slideshow-rs/Cargo.toml` version  
3. Update `public/js/app.js` version display
4. Commit, tag, and push

## Version Strategy

Follow [Semantic Versioning](https://semver.org/):
- **MAJOR.MINOR.PATCH** (e.g., 1.2.3)
- **PATCH** (0.1.0 → 0.1.1): Bug fixes, small improvements
- **MINOR** (0.1.0 → 0.2.0): New features, backwards compatible
- **MAJOR** (0.1.0 → 1.0.0): Breaking changes, major milestones

## Step-by-Step Manual Process

### 1. Update package.json
```bash
# Edit package.json line 3:
"version": "0.2.0",
```

### 2. Update Rust Component
```bash
# Edit pi-slideshow-rs/Cargo.toml line 3:
version = "0.2.0"
```

### 3. Update UI Version Display
```bash
# Edit public/js/app.js around line 1151:
this.updateVersionDisplay('0.2.0');
```

### 4. Commit and Tag
```bash
git add -A
git commit -m "Bump version to 0.2.0"
git tag -a v0.2.0 -m "Release v0.2.0"
git push origin main
git push origin v0.2.0
```

### 5. Create GitHub Release
```bash
gh release create v0.2.0 --title "Release v0.2.0" --notes "Release notes here"
```

## Alternative: npm version Command

For Node.js component only (still need manual Rust + UI updates):
```bash
npm version patch   # 0.1.0 → 0.1.1
npm version minor   # 0.1.0 → 0.2.0  
npm version major   # 0.1.0 → 1.0.0
```

## Files That Need Version Updates

1. **`package.json`** - Line 3: `"version": "X.Y.Z"`
2. **`pi-slideshow-rs/Cargo.toml`** - Line 3: `version = "X.Y.Z"`
3. **`public/js/app.js`** - Line ~1151: `this.updateVersionDisplay('X.Y.Z')`

## Version Release Checklist

- [ ] Update all three version locations
- [ ] Test locally (`npm run dev`)
- [ ] Run linting (`npm run lint`)
- [ ] Commit with descriptive message
- [ ] Create annotated git tag
- [ ] Push commits and tags
- [ ] Create GitHub release with notes
- [ ] Update project documentation if needed

## Common Version Patterns

- **Bug fixes**: 0.1.0 → 0.1.1 → 0.1.2
- **New features**: 0.1.0 → 0.2.0 → 0.3.0
- **Major release**: 0.9.0 → 1.0.0
- **Breaking changes**: 1.2.0 → 2.0.0

## Troubleshooting

**If versions get out of sync:**
1. Check all three files manually
2. Update any that don't match
3. Commit with message "Sync version numbers"

**If you forget to update UI version:**
- Users will see old version in dashboard
- Update `public/js/app.js` and redeploy