# Test Suite Organization

This directory contains test utilities and future test suites for the Digital Signage Management System.

## Directory Structure

```
tests/
├── integration/         # Integration test utilities and scripts
│   ├── mqtt/           # MQTT-related test utilities
│   └── slideshow/      # Slideshow functionality tests
└── unit/               # Unit tests (future)
```

## Test Utilities

### MQTT Integration Tests

**`integration/mqtt/send-config-update.js`**
- Utility script for testing MQTT configuration updates
- Sends config update commands to specific TV endpoints
- Usage: `node tests/integration/mqtt/send-config-update.js`

### Slideshow Integration Tests

**`integration/slideshow/test-image-reload.sh`**
- Tests the image reload functionality in pi-slideshow-rs
- Verifies that images are loaded only when needed, not repeatedly
- Usage: `./tests/integration/slideshow/test-image-reload.sh`

## Running Tests

### Prerequisites
- MQTT broker running on 192.168.1.215:1883
- pi-slideshow-rs built and ready to run
- Node.js dependencies installed (`npm install`)

### Future Test Development
- Unit tests will be added to the `unit/` directory
- Jest is configured in package.json for JavaScript testing
- Supertest is available for API endpoint testing