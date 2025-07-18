# 🏗️ Digital Signage System Architecture

## 🎯 System Overview

Digital signage solution using pi-slideshow-rs on Raspberry Pi endpoints with centralized management system for 8 TV displays.

**Current Status:** Phase 2 (Basic Layer Infrastructure) - 100% Complete ✅

## 🔧 Technology Stack

### Core Components
- **Backend:** Node.js/Express with WebSocket support
- **Database:** CouchDB (document-based storage, replication, image attachments)
- **Message Broker:** MQTT (lightweight IoT messaging, pub/sub patterns)
- **TV Control:** pi-slideshow-rs (Rust-based slideshow controller)
- **Image Processing:** Sharp (server-side) + local caching on TV endpoints
- **Security:** Helmet.js, CORS, Joi validation ⚠️ **Incomplete**

### Dual-Protocol Communication Strategy

**CouchDB (Persistent Data Protocol):**
- **Purpose:** Long-term storage, complex queries, large binary data
- **Used for:** TV configurations, image metadata, image files (attachments), audit logs
- **Benefits:** ACID transactions, offline replication, conflict resolution
- **Access:** Direct database connections from both management server and TV endpoints

**MQTT (Real-time Messaging Protocol):**
- **Purpose:** Lightweight real-time communication, pub/sub patterns, ephemeral data
- **Used for:** Control commands (play/pause/next), status updates, heartbeats, notifications
- **Benefits:** Low latency, minimal bandwidth, automatic reconnection, QoS levels
- **Access:** Publish/subscribe through central message broker

## 📁 Project Structure

```
src/
├── config/database.js              # CouchDB connection setup
├── controllers/                    # ✅ MVC controllers implemented
├── middleware/upload.js            # Multer file upload with Sharp processing
├── models/
│   ├── image.js                   # Image document model
│   └── tv.js                      # TV document model
├── routes/
│   ├── dashboardRoutes.js         # Dashboard API endpoints
│   ├── imageRoutes.js             # Image management endpoints
│   └── tvRoutes.js                # TV management endpoints
├── services/mqttService.js        # MQTT client service
├── server.js                      # Main application entry point
└── utils/                         # ✅ Utility functions available

pi-slideshow-rs/
├── src/
│   ├── main.rs                    # Main application entry
│   ├── slideshow_controller.rs    # Core slideshow logic
│   ├── layer_manager.rs           # ✅ Layer compositing system
│   ├── http_server.rs             # REST API server
│   ├── mqtt_client.rs             # MQTT communication
│   └── couchdb_client.rs          # Database client
└── build.rs                       # Build configuration

public/
├── index.html                     # Admin panel frontend
├── css/style.css                  # Frontend styling
└── js/app.js                      # Frontend JavaScript with WebSocket
```

## 🔄 Data Flow Architecture

### Image Upload Flow
```
Web UI → Express Upload → Sharp Processing → CouchDB Storage → MQTT Notification → TV Sync
```

### Real-time Control Flow
```
Web UI → WebSocket → MQTT Service → TV MQTT Client → Slideshow Controller → Display Update
```

### TV Status Flow
```
TV Status → MQTT Publish → MQTT Service → WebSocket → Web UI Dashboard
```

## 🖥️ TV Endpoint Architecture

### TV Communication Patterns
- **MQTT Command Topic:** `signage/tv/{id}/command` (receive control commands)
- **MQTT Status Topic:** `signage/tv/{id}/status` (publish status updates)
- **MQTT Heartbeat Topic:** `signage/tv/{id}/heartbeat` (health monitoring)
- **CouchDB Queries:** Direct database access for images and configuration
- **HTTP API:** `http://pi-ip:8080/api/` (local control interface)

### TV Operational Flow
1. **Startup:** Connect to both CouchDB and MQTT broker
2. **Image Sync:** Query CouchDB for assigned images, download as attachments
3. **Real-time Control:** Listen for MQTT commands, respond immediately
4. **Status Reporting:** Publish status via MQTT, persist state in CouchDB
5. **Offline Operation:** Continue slideshow using cached images if network fails
6. **Layer Compositing:** Render slideshow base layer with optional static overlay

## 🎨 Layer System Architecture (Phase 2 - Complete)

### Layer Compositing Pipeline
```
CouchDB Layer Config → Rust LayerManager → Image Loading → Alpha Blending → Composite Render → Display
```

### Layer Types (v0.3.0)
- **Slideshow Layer:** Base layer with transitioning images (always present)
- **Static Overlay:** Logo or watermark overlay (PNG with alpha channel)

### Layer Configuration Flow
1. **Management UI:** Configure layer settings via web interface
2. **API Storage:** Layer config stored in TV document (CouchDB)
3. **MQTT Notification:** Real-time layer updates via MQTT
4. **Rust Sync:** LayerManager reads config from CouchDB
5. **Compositing:** blend_images_simple() creates final composite
6. **Display:** Rendered composite displayed on TV endpoint

### Layer Control Commands (MQTT)
- `signage/tv/{id}/layers/visibility` - Toggle layer visibility
- `signage/tv/{id}/config` - Update layer configuration

### Technical Implementation
- **Rust Structures:** Layer, LayerManager, LayerConfig
- **Alpha Blending:** `blend_images_simple()` function
- **Performance:** Optimized for Raspberry Pi 4 hardware
- **Positioning:** Configurable overlay position and opacity

## 📊 Protocol Usage Decision Matrix

| Operation Type | Protocol | Rationale |
|----------------|----------|-----------|
| Image uploads | CouchDB | Large binary data, permanent storage, attachment support |
| TV configurations | CouchDB | Persistent settings, complex validation, ACID transactions |
| Image assignments | CouchDB | Relational data, complex queries, referential integrity |
| Play/pause commands | MQTT | Real-time response, ephemeral, fire-and-forget |
| Status updates | MQTT | High frequency, lightweight, pub/sub to dashboard |
| Heartbeats | MQTT | Frequent ping data, automatic cleanup |
| Current image sync | Both | MQTT for real-time notification + CouchDB for persistence |

## 🎨 Current Phase Progress

### ✅ Phase 1: Enhanced Orientation Support (Complete)
- Portrait/landscape TV support
- Image rotation and scaling
- Basic configuration management

### 🚧 Phase 2: Basic Layer Infrastructure (In Progress - 20%)

**Completed:**
- ✅ Alpha blending function (`blend_images_simple`)
- ✅ Image loading with orientation support
- ✅ Basic CouchDB + MQTT architecture

**Missing (Blockers):**
- ❌ Layer and LayerManager structures
- ❌ 2-layer compositing implementation
- ❌ Layer configuration in TV settings
- ❌ Overlay positioning system

### ⏳ Future Phases (Planned)
- **Phase 3:** Multi-layer Compositing
- **Phase 4:** Advanced Layer Management
- **Phase 5:** Production Features

## 🔧 Development Architecture Patterns

### Model Pattern (Current - Need Improvement)
```javascript
// TV and Image models follow similar CRUD patterns
// ⚠️ Code duplication issue - need base model class
class TV {
  static async findById(id) { /* CouchDB query */ }
  static async findAll() { /* CouchDB query */ }
  async save() { /* CouchDB save */ }
  async delete() { /* CouchDB delete */ }
}
```

### Route Pattern (Current - Need Controllers)
```javascript
// Route files contain business logic directly
// ⚠️ Should be extracted to controller classes
router.get('/tvs', async (req, res) => {
  // Business logic here - should be in controller
});
```

### Error Handling (Current - Inconsistent)
```javascript
// Mix of different error patterns across codebase
// ⚠️ Need centralized error middleware
try { /* operation */ } catch (err) { res.status(500).send(err); }
```

## 🔐 Security Architecture (Incomplete)

### Current Security (Minimal)
- ✅ Helmet.js for basic headers
- ✅ CORS configuration
- ✅ Basic file upload limits

### Missing Security (Critical)
- ❌ API authentication/authorization
- ❌ Rate limiting on endpoints
- ❌ Input validation schemas
- ❌ File upload security validation
- ❌ MQTT broker authentication

## 🚀 Performance Characteristics

### Build Performance
- **Current:** ~20-30 seconds (acceptable)
- **Target:** <30 seconds for fast iteration

### Runtime Performance
- **Image Processing:** Sharp optimization for resizing
- **Database:** CouchDB replication for local caching
- **Network:** MQTT for low-latency commands
- **Memory:** Rust slideshow for efficient resource usage

## 🔧 Configuration Management

### Current Configuration
```javascript
// Hardcoded values in code - needs improvement
const COUCHDB_URL = 'http://localhost:5984';
const MQTT_BROKER = 'mqtt://localhost:1883';
```

### Needed Configuration System
- Environment-based configuration
- TV-specific settings
- Layer configuration parameters
- Security settings

## 🐛 Known Architectural Issues

### High Priority
1. **Empty Controllers Directory** - MVC pattern not properly implemented
2. **Missing Error Middleware** - No centralized error handling
3. **Security Gaps** - No authentication or rate limiting
4. **Input Validation Missing** - Endpoints accept unvalidated input

### Medium Priority
1. **Code Duplication** - Models have repeated CRUD methods
2. **Hardcoded Configuration** - Values should be environment-based
3. **Inconsistent Patterns** - Mix of async/await and promises

## 🎯 Next Architecture Steps

1. **Implement MVC Pattern** - Extract controllers from routes
2. **Add Error Middleware** - Centralized error handling
3. **Security Layer** - Authentication, validation, rate limiting
4. **Layer Infrastructure** - Rust Layer/LayerManager structures
5. **Configuration System** - Environment-based configuration