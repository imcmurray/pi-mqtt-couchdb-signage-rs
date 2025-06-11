# Environment Configuration Plan

## Overview
Plan to enable multiple environments (branches) to run simultaneously with different ports, database names, and MQTT topics.

## Current State Analysis

### Port Configuration
- **Current Default**: Port 3000 in `src/server.js`
- **Docker Files**: All expose port 3000 (Dockerfile, Dockerfile-dev, Dockerfile-prod)
- **Docker Compose**: All map to port 3000 with `PORT=3000` environment variable
- **Documentation**: Multiple README examples reference port 3000
- **Frontend**: Dynamically adapts to current host port

### Database Configuration
- **Node.js**: Uses `COUCHDB_DATABASE` environment variable with `digital_signage` fallback
- **Rust**: Hardcoded `digital_signage` in two files:
  - `pi-slideshow-rs/src/couchdb_client.rs`
  - `src/couchdb_client.rs` (duplicate)

### MQTT Topics
- **Current Prefix**: `signage/`
- **Topic Structure**:
  ```
  signage/
  ├── tv/{id}/command      (Server → TV)
  ├── tv/{id}/status       (TV → Server)
  ├── tv/{id}/heartbeat    (TV → Server)
  ├── tv/{id}/error        (TV → Server)
  └── tv/{id}/image/current (TV → Server)
  ```

## Problem Statement
Need to run feature branches simultaneously with main branch:
- **Main Branch**: Port 3000, database `digital_signage`, MQTT topic `signage/`
- **Feature Branch**: Port 3001, database `digital_signage_3001`, MQTT topic `signage_3001/`

## Recommended Solution: Environment-Based Configuration

Instead of hardcoding values, create a unified configuration system using environment variables.

### Proposed Environment Variables
```bash
PORT=3001
COUCHDB_DATABASE=digital_signage_3001
MQTT_TOPIC_PREFIX=signage_3001
ENVIRONMENT_NAME=development
```

## Implementation Plan

### Phase 1: Create Environment Configuration System

1. **Create centralized config module** (`src/config/environment.js`)
   - Load environment-specific settings
   - Provide defaults for all configurable values
   - Export consistent config object

2. **Update existing configuration files**
   - Modify `src/config/database.js` to use new config system
   - Update `src/services/mqttService.js` to use configurable topic prefix

### Phase 2: Update Application Code

3. **Update Node.js application**
   - Modify `src/server.js` to use environment config
   - Update all MQTT service methods to use configurable topic prefix
   - Update routes and controllers to use environment-aware settings

4. **Update Rust pi-slideshow-rs**
   - Make database name configurable via environment variable in both:
     - `pi-slideshow-rs/src/couchdb_client.rs`
     - `src/couchdb_client.rs` (remove duplicate or make consistent)
   - Make MQTT topic prefix configurable
   - Update Cargo.toml if needed for environment variable support

### Phase 3: Update Infrastructure Configuration

5. **Update Docker configuration**
   - Modify Dockerfiles to accept PORT environment variable dynamically
   - Update docker-compose files to use environment-specific values
   - Create separate docker-compose files for different environments

6. **Update documentation**
   - Update README.md examples to show environment configuration
   - Update pi-slideshow-rs README with new configuration options
   - Document environment variable usage

### Phase 4: Create Environment-Specific Settings

7. **Create branch-specific environment file**
   - `.env.development` with:
     ```bash
     PORT=3001
     COUCHDB_DATABASE=digital_signage_3001
     MQTT_TOPIC_PREFIX=signage_3001
     ENVIRONMENT_NAME=development
     ```
   - Ensure `.env.development` is in `.gitignore`
   - Provide `.env.development.example` for reference

## Configuration File Structure

### Proposed `src/config/environment.js`
```javascript
const config = {
  port: process.env.PORT || 3000,
  database: {
    name: process.env.COUCHDB_DATABASE || 'digital_signage',
    url: process.env.COUCHDB_URL || 'http://localhost:5984'
  },
  mqtt: {
    topicPrefix: process.env.MQTT_TOPIC_PREFIX || 'signage',
    brokerUrl: process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883'
  },
  environment: process.env.ENVIRONMENT_NAME || 'production'
};
```

### Example Environment Files

#### `.env.production` (main branch)
```bash
PORT=3000
COUCHDB_DATABASE=digital_signage
MQTT_TOPIC_PREFIX=signage
ENVIRONMENT_NAME=production
```

#### `.env.development` (feature branch)
```bash
PORT=3001
COUCHDB_DATABASE=digital_signage_3001
MQTT_TOPIC_PREFIX=signage_3001
ENVIRONMENT_NAME=development
```

## Benefits

1. **Concurrent Environments**: Run multiple branches simultaneously
2. **Easy Configuration**: Change environment variables without code changes
3. **Docker Compatibility**: Works seamlessly with containerized deployments
4. **Documentation Clarity**: Single source of truth for configuration
5. **Future Flexibility**: Easy to add new configurable parameters

## Files That Need Changes

### Node.js Files
- `src/config/environment.js` (new file)
- `src/config/database.js`
- `src/services/mqttService.js`
- `src/server.js`
- `.env.development` (new file)
- `.env.development.example` (new file)

### Rust Files
- `pi-slideshow-rs/src/couchdb_client.rs`
- `pi-slideshow-rs/src/mqtt_client.rs`
- `src/couchdb_client.rs` (evaluate if duplicate needed)

### Infrastructure Files
- `Dockerfile`, `Dockerfile-dev`, `Dockerfile-prod`
- `docker-compose.yml`, `docker-compose.yml-dev`, `docker-compose.yml-prod`

### Documentation Files
- `README.md`
- `pi-slideshow-rs/README.md`

## Next Steps

1. Review and approve this plan
2. Implement Phase 1 (environment configuration system)
3. Test configuration system with current setup
4. Proceed with remaining phases
5. Validate concurrent environment functionality

## Notes

- This approach maintains backward compatibility
- Environment variables take precedence over defaults
- Configuration is centralized but accessible throughout the application
- Rust code will need environment variable handling added