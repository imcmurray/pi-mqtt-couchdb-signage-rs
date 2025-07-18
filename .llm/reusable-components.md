# Reusable Components & Patterns Catalog

## 🗄️ Database Models & Methods

### BaseModel (`src/models/BaseModel.js`)
**Purpose**: Base class providing common CRUD operations for all models

**Key Methods**:
- `BaseModel.findAll(viewName, ModelClass)` - Get all documents from CouchDB view
- `BaseModel.findById(id, expectedType, ModelClass)` - Find specific document by ID
- `BaseModel.findByView(viewName, viewKey, key, ModelClass)` - Query by specific view
- `BaseModel.paginate(viewName, limit, skip, ModelClass)` - Paginated results
- `BaseModel.exists(id)` - Check if document exists
- `BaseModel.bulkUpdate(documents)` - Update multiple documents
- `model.save()` - Save/create document
- `model.update(updates)` - Update document with new data
- `model.delete()` - Delete document
- `model.validateRequired(fields)` - Validate required fields
- `model.getMetadata()` - Get document metadata

### TV Model (`src/models/tv.js`)
**Purpose**: Manages TV endpoint data and configuration (extends BaseModel)

**Key Methods**:
- `TV.findAll()` - Get all TVs (uses BaseModel)
- `TV.findById(id)` - Find specific TV (uses BaseModel)
- `TV.findByStatus(status)` - Find TVs by status (uses BaseModel)
- `TV.findOffline(timeoutMs)` - Get TVs that haven't sent heartbeat
- `TV.getStats()` - Get aggregate statistics for all TVs
- `tv.save()` - Save with validation (extends BaseModel)
- `tv.updateHeartbeat()` - Update last heartbeat and set online
- `tv.hasLayerSupport()` - Check if TV supports layers
- `tv.getActiveLayers()` - Get enabled layers sorted by priority

**Configuration Structure** (including Phase 2):
```javascript
config: {
  transition_effect: 'fade',
  display_duration: 5000,
  resolution: '1920x1080', 
  orientation: 'landscape',
  layers: {
    slideshow: { enabled: true, position: {...}, priority: 1, opacity: 1.0 }
  },
  layer_settings: {
    max_layers: 10,
    compositing_timeout_ms: 5000,
    cache_composites: true
  }
}
```

### Image Model (`src/models/image.js`)
**Purpose**: Manages image documents and CouchDB attachments (extends BaseModel)

**Key Methods**:
- `Image.findAll()` - Get all active images (filters by status)
- `Image.findById(id)` - Find specific image (uses BaseModel)
- `Image.findByTvId(tvId)` - Get images assigned to TV, sorted by order
- `Image.findByStatus(status)` - Find images by status (uses BaseModel)
- `Image.getStats()` - Get aggregate statistics (size, count, types)
- `image.saveWithAttachment(buffer, contentType)` - Save image with binary data
- `image.getAttachment()` - Retrieve image binary data
- `image.assignToTv(tvId, order)` - Assign image to TV with order
- `image.unassignFromTv(tvId)` - Remove assignment
- `image.bulkAssignToTvs(tvIds, startOrder)` - Assign to multiple TVs
- `image.isScheduledNow()` - Check if image should display based on schedule
- `image.getAssignmentSummary()` - Get TV assignment details
- `image.hasAttachment()` - Check if attachment exists
- `image.delete()` - Delete with attachment cleanup (overrides BaseModel)

**Data Structure** (lines 12-27):
```javascript
{
  assigned_tvs: [], // Array of TV IDs
  tv_orders: {}, // Object mapping TV ID to order position
  metadata: { width, height, description, tags },
  schedule: { start_time, end_time, days_of_week }
}
```

## 🌐 MQTT Message Handlers & Patterns

### MQTT Service (`src/services/mqttService.js`)
**Purpose**: Centralized MQTT communication with pub/sub patterns

**Message Handling Pattern** (lines 84-106):
```javascript
// Topic structure: signage/tv/{tvId}/{messageType}
switch (messageType) {
  case 'status': await this.handleStatusUpdate(tvId, payload);
  case 'heartbeat': await this.handleHeartbeat(tvId, payload);
  case 'error': await this.handleError(tvId, payload);
  case 'image': if (parts[4] === 'current') { ... }
}
```

**Command Methods** (lines 206-233):
- `playSlideshow(tvId)` - Send play command
- `pauseSlideshow(tvId)` - Send pause command
- `nextImage(tvId)` - Advance to next image
- `updateImages(tvId, imageList)` - Send image list update
- `updateConfig(tvId, config)` - Send configuration update

**Auto-Registration Pattern** (lines 136-154):
```javascript
// Auto-create TV from heartbeat if it doesn't exist
if (!tv) {
  const newTv = new TV({
    _id: `tv_${tvId}`,
    name: `Auto-discovered Display (${tvId})`,
    // ... default config
  });
  await newTv.save();
}
```

**Offline Monitoring** (lines 266-297):
- Checks heartbeat timeout every 30 seconds
- Updates TV status to offline after 90 seconds
- Notifies WebSocket subscribers of status changes

## 🖼️ Image Processing Utilities

### Upload Middleware (`src/middleware/upload.js`)
**Purpose**: Handles file upload with validation and error handling

**Configuration** (lines 17-25):
```javascript
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB default
    files: 10 // Maximum 10 files per request
  },
  fileFilter: allowedTypes.includes(file.mimetype)
});
```

**Error Handling Pattern** (lines 28-59):
- Handles `LIMIT_FILE_SIZE`, `LIMIT_FILE_COUNT`, `LIMIT_UNEXPECTED_FILE`
- Returns structured error responses with user-friendly messages

### Sharp Image Processing (in `imageRoutes.js`)
**Usage Pattern** (lines 129-145):
```javascript
const metadata = await sharp(file.buffer).metadata();
const image = new Image({
  metadata: {
    width: metadata.width,
    height: metadata.height,
    // ...
  }
});
await image.saveWithAttachment(file.buffer, file.mimetype);
```

## ✅ Validation Patterns

### Joi Schema Validation
**TV Validation** (`src/routes/tvRoutes.js` lines 8-18):
```javascript
const tvSchema = Joi.object({
  name: Joi.string().required(),
  location: Joi.string().required(),
  ip_address: Joi.string().ip().required(),
  config: Joi.object({
    transition_effect: Joi.string().valid('fade', 'slide', 'wipe', 'dissolve'),
    display_duration: Joi.number().min(1000).max(60000),
    orientation: Joi.string().valid('landscape', 'portrait', 'inverted_landscape', 'inverted_portrait')
  })
});
```

**Usage Pattern** (lines 54-58):
```javascript
const { error, value } = tvSchema.validate(req.body);
if (error) {
  return res.status(400).json({ error: error.details[0].message });
}
```

**Image Assignment Validation** (`src/routes/imageRoutes.js` lines 25-37):
```javascript
const assignmentSchema = Joi.object({
  tv_ids: Joi.array().items(Joi.string()).required(),
  order: Joi.number().min(0).default(0)
});

const reorderSchema = Joi.object({
  images: Joi.array().items(
    Joi.object({
      image_id: Joi.string().required(),
      order: Joi.number().min(0).required()
    })
  ).required()
});
```

## 🚨 Error Handling Patterns

### Standard Error Response Pattern
**Used throughout routes** (e.g., `tvRoutes.js` lines 32-35):
```javascript
try {
  // operation
} catch (error) {
  console.error('Error description:', error);
  res.status(500).json({ error: 'User-friendly message' });
}
```

### Not Found Pattern (lines 42-44):
```javascript
if (!resource) {
  return res.status(404).json({ error: 'Resource not found' });
}
```

### Database Error Handling
**CouchDB-specific** (`src/models/tv.js` lines 41-46):
```javascript
try {
  const doc = await db.get(id);
  return doc.type === 'tv' ? new TV(doc) : null;
} catch (error) {
  if (error.statusCode === 404) {
    return null; // Not found is expected
  }
  throw error; // Re-throw unexpected errors
}
```

## ⚙️ Configuration Utilities

### Database Configuration (`src/config/database.js`)
**Environment-based URL Building** (lines 5-18):
```javascript
const couchdbUrl = (() => {
  const baseUrl = process.env.COUCHDB_URL || 'http://192.168.1.215:5984';
  const username = process.env.COUCHDB_USERNAME;
  const password = process.env.COUCHDB_PASSWORD;
  
  if (username && password) {
    const url = new URL(baseUrl);
    url.username = username;
    url.password = password;
    return url.toString();
  }
  return baseUrl;
})();
```

**Design Document Creation Pattern** (lines 49-145):
- Automatic view creation for TVs and images
- Handles existing document updates with revision tracking
- Error handling for each design document

### MQTT Configuration (`src/services/mqttService.js`)
**Connection Options Pattern** (lines 16-26):
```javascript
const options = {
  keepalive: 60,
  connectTimeout: 30 * 1000,
  reconnectPeriod: 1000,
  clean: true,
};

if (process.env.MQTT_USERNAME && process.env.MQTT_PASSWORD) {
  options.username = process.env.MQTT_USERNAME;
  options.password = process.env.MQTT_PASSWORD;
}
```

## 🌐 HTTP/API Patterns

### REST Resource Pattern
**Standard CRUD operations** (from `tvRoutes.js`):
- `GET /api/tvs` - List all (line 28)
- `GET /api/tvs/:id` - Get specific (line 39) 
- `POST /api/tvs` - Create new (line 53)
- `PUT /api/tvs/:id` - Update existing (line 141)
- `DELETE /api/tvs/:id` - Delete (line 170)

### Control Actions Pattern (`tvRoutes.js` lines 186-222):
```javascript
// POST /api/tvs/:id/control/:action
const { action } = req.params;
const tvId = tv._id.replace('tv_', ''); // Strip prefix for MQTT

switch (action) {
  case 'play': await mqttService.playSlideshow(tvId); break;
  case 'pause': await mqttService.pauseSlideshow(tvId); break;
  case 'next': await mqttService.nextImage(tvId); break;
  // ...
}
```

### File Serving Pattern (`imageRoutes.js` lines 95-116):
```javascript
// GET /api/images/:id/attachment
const imageBuffer = await image.getAttachment();
res.set({
  'Content-Type': image.mimetype,
  'Content-Length': imageBuffer.length,
  'Cache-Control': 'public, max-age=31536000', // 1 year cache
});
res.send(imageBuffer);
```

### Bulk Operations Pattern (`imageRoutes.js`)
- **Bulk Assignment** (lines 244-276): Validate all TV IDs, then assign to multiple
- **Reordering** (lines 328-382): Update order for multiple images in single request
- **Shuffling** (lines 384-434): Randomize order with single API call

## 🦀 Rust Utilities (pi-slideshow-rs)

### Orientation Handling (`pi-slideshow-rs/src/main.rs`)
**Enum with Rotation Logic** (lines 18-47):
```rust
#[derive(Debug, Clone, PartialEq)]
enum Orientation {
    Landscape, Portrait, InvertedLandscape, InvertedPortrait,
}

impl Orientation {
    fn rotate_image(&self, img: &RgbaImage) -> RgbaImage {
        match self {
            Orientation::Landscape => img.clone(),
            Orientation::Portrait => image::imageops::rotate90(img),
            Orientation::InvertedLandscape => image::imageops::rotate180(img),
            Orientation::InvertedPortrait => image::imageops::rotate270(img),
        }
    }
}
```

### Transition System (lines 134-236):
**Comprehensive Effect Types**:
- Basic: Fade, Dissolve, Slide (Left/Right/Up/Down)
- Advanced: Wipe, CircularWipe, DiagonalWipe, Pixelate, Morph
- Easing: Bounce, Elastic, EaseIn/Out, Accelerated

**Transition Factory Pattern** (lines 185-210):
```rust
fn from_string(s: &str) -> Option<Self> {
    match s.to_lowercase().as_str() {
        "fade" => Some(Self::Fade),
        "dissolve" => Some(Self::Dissolve),
        // ... all transition types
        "random" => Some(Self::get_random()),
        _ => None,
    }
}
```

### Framebuffer Management (lines 244-488):
**Memory Mapping with Fallbacks**:
- Try memory mapping for performance
- Fall back to direct file writes if mapping fails
- File output fallback for development/testing

### Command Line Interface (`pi-slideshow-rs/src/main.rs`)
**Clap Parser Pattern** (lines 62-112):
```rust
#[derive(Parser, Debug)]
struct Args {
    #[arg(short, long, default_value = ".")]
    image_dir: PathBuf,
    
    #[arg(short, long, default_value_t = 30)]
    delay: u64,
    
    #[arg(long, default_value = "mqtt://192.168.1.215:1883")]
    mqtt_broker: String,
    
    // ... more arguments with defaults
}
```

### Controller Architecture (`pi-slideshow-rs/src/slideshow_controller.rs`)
**Async State Management Pattern** (lines 28-54):
```rust
pub struct SlideshowController {
    config: Arc<RwLock<ControllerConfig>>,
    state: Arc<RwLock<SlideshowState>>,
    current_index: Arc<RwLock<usize>>,
    images: Arc<RwLock<Vec<ImageInfo>>>,
    // Channels for communication
    command_receiver: broadcast::Receiver<SlideshowCommand>,
    status_sender: mpsc::Sender<TvStatus>,
}
```

## 🔗 Integration Patterns

### TV ID Mapping Pattern
**Consistent throughout codebase**:
- Database: `tv_${id}` (e.g., `tv_raspberry-pi-001`)
- MQTT: `${id}` (e.g., `raspberry-pi-001`)
- Conversion: `tv._id.replace('tv_', '')` for MQTT

### Dual Protocol Architecture
**CouchDB + MQTT Usage**:
- **CouchDB**: Persistent data (images, config, metadata)
- **MQTT**: Real-time commands (play/pause, status updates)
- **Pattern**: Store in CouchDB, notify via MQTT

### Error Recovery Patterns
**Timeout + Fallback** (used in Rust controller):
```rust
match tokio::time::timeout(Duration::from_secs(5), operation).await {
    Ok(Ok(result)) => println!("Success: {:?}", result),
    Ok(Err(e)) => eprintln!("Warning: Failed - {}", e),
    Err(_) => eprintln!("Warning: Timeout - continuing without"),
}
```

### Auto-Registration Pattern
**Used in both Node.js and Rust**:
1. Heartbeat from TV endpoint
2. Check if TV exists in database  
3. Create with default config if not found
4. Update IP/status if exists

## 🎯 Key Reuse Opportunities

1. **Validation Schemas**: Extend existing Joi schemas for new resources
2. **Error Handling**: Use standard patterns for consistent API responses  
3. **MQTT Message Handlers**: Follow topic structure for new message types
4. **Model Methods**: Extend TV/Image patterns for new document types
5. **Route Structure**: Use REST + control action pattern for new resources
6. **Database Views**: Follow design document pattern for new queries
7. **Rust Transitions**: Add new effects to TransitionType enum
8. **Configuration**: Use environment-based config pattern throughout
9. **Layer System**: Use LayerManager pattern for compositing operations

## 🎨 Layer System Components (v0.3.0)

### LayerManager (`pi-slideshow-rs/src/layer_manager.rs`)
**Purpose**: Manages 2-layer compositing system with slideshow base + static overlay

**Key Structures**:
```rust
#[derive(Debug, Clone)]
pub struct Layer {
    pub id: String,
    pub layer_type: LayerType,
    pub enabled: bool,
    pub opacity: f32,
    pub priority: u8,
    pub content: LayerContent,
}

#[derive(Debug, Clone)]
pub enum LayerType {
    Slideshow,     // Background layer
    StaticOverlay, // Logo/image overlay
}

pub struct LayerManager {
    layers: Vec<Layer>,
    width: u32,
    height: u32,
}
```

**Key Methods**:
- `LayerManager::new(width, height)` - Create manager with screen dimensions
- `add_layer(layer)` - Add layer to collection
- `remove_layer(id)` - Remove layer by ID
- `render_composite()` - Create final composite image
- `set_layer_visibility(id, visible)` - Toggle layer visibility
- `get_sorted_layers()` - Get layers sorted by priority

**Alpha Blending Function** (`pi-slideshow-rs/src/main.rs`):
```rust
fn blend_images_simple(base: &RgbaImage, overlay: &RgbaImage, overlay_opacity: f32) -> RgbaImage {
    // Pixel-by-pixel RGBA alpha blending
    // Used by LayerManager for compositing
}
```

### Layer Configuration in TV Model
**Database Schema Extension** (`src/models/tv.js`):
```javascript
config: {
  layers: {
    slideshow: {
      enabled: true,
      priority: 1,
      opacity: 1.0,
      position: { x: 0, y: 0, width: 1920, height: 1080 }
    },
    overlay: {
      enabled: false,
      image_path: null,
      priority: 10,
      opacity: 0.8,
      position: { x: 50, y: 50, width: 200, height: 100 }
    }
  }
}
```

### Layer Control API Endpoints
**Layer Management Routes** (`src/routes/tvRoutes.js`):
- `GET /api/tvs/:id/layers` - Get layer configuration
- `PUT /api/tvs/:id/layers` - Update layer configuration
- `POST /api/tvs/:id/layers/:layerId/visibility` - Toggle layer visibility

### Layer MQTT Commands
**Real-time Layer Control**:
- Topic: `signage/tv/{id}/layers/visibility`
- Topic: `signage/tv/{id}/config` (includes layer updates)
- Payload: `{ "layer_id": "overlay", "visible": true }`

**MQTT Service Integration** (`src/services/mqttService.js`):
```javascript
// Layer control commands
async toggleLayerVisibility(tvId, layerId, visible) {
  const topic = `signage/tv/${tvId}/layers/visibility`;
  const payload = { layer_id: layerId, visible };
  await this.publish(topic, payload);
}
```

### Layer Compositing Pipeline
**Integration Pattern**:
1. **Database**: Layer config stored in TV model
2. **MQTT**: Real-time layer updates
3. **Rust Sync**: LayerManager reads from CouchDB
4. **Compositing**: Alpha blending creates final image
5. **Display**: Composite rendered to framebuffer

**Performance Characteristics**:
- Render time: <100ms for 2-layer composite
- Memory usage: <50MB additional overhead
- CPU impact: <10% during transitions

### Layer Validation Schema
**Joi Validation** (`src/routes/tvRoutes.js`):
```javascript
const layerSchema = Joi.object({
  layers: Joi.object({
    slideshow: Joi.object({
      enabled: Joi.boolean().default(true),
      priority: Joi.number().min(1).max(255).default(1),
      opacity: Joi.number().min(0).max(1).default(1.0)
    }),
    overlay: Joi.object({
      enabled: Joi.boolean().default(false),
      image_path: Joi.string().allow(null),
      priority: Joi.number().min(1).max(255).default(10),
      opacity: Joi.number().min(0).max(1).default(0.8)
    })
  })
});
```

### Reusable Layer Patterns
1. **Layer Addition**: Extend LayerType enum for new layer types
2. **Configuration**: Add layer config to TV model structure
3. **API Endpoints**: Follow REST pattern for layer management
4. **MQTT Control**: Use topic structure for real-time updates
5. **Compositing**: Leverage existing alpha blending for new layer types

## 🌐 Server Setup & WebSocket Patterns

### Express Server Configuration (`src/server.js`)
**Security Middleware Pattern** (lines 23-30):
```javascript
if (process.env.NODE_ENV === 'production') {
  app.use(helmet());
} else {
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  }));
}
```

**Static File Serving** (lines 36-42):
```javascript
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/public', express.static(path.join(__dirname, '../public')));
// Direct path mapping for easier HTML references
app.use('/css', express.static(path.join(__dirname, '../public/css')));
app.use('/js', express.static(path.join(__dirname, '../public/js')));
```

**Health Check Endpoint** (lines 49-57):
```javascript
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    mqtt_connected: mqttService.isConnected,
    uptime: process.uptime()
  });
});
```

### Version Information Pattern (`src/server.js`)
**Git-based Version Retrieval** (lines 60-133):
- Reads from `version.json` if available (build-time generated)
- Falls back to live git commands in development
- Detects dirty working directory
- Combines management UI version from package.json

### WebSocket Real-time Updates (`src/server.js`)
**MQTT-to-WebSocket Bridge** (lines 140-186):
```javascript
wss.on('connection', (ws) => {
  const subscriberId = Date.now().toString();
  
  // Bridge MQTT updates to WebSocket clients
  mqttService.addSubscriber(subscriberId, (data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'mqtt_update',
        data
      }));
    }
  });
  
  ws.on('close', () => {
    mqttService.removeSubscriber(subscriberId);
  });
});
```

**Message Type Pattern** (lines 162-171):
```javascript
switch (data.type) {
  case 'ping': ws.send(JSON.stringify({ type: 'pong' })); break;
  case 'subscribe_tv': /* handle TV-specific subscriptions */ break;
  default: console.log('Unknown message type:', data.type);
}
```

### Graceful Shutdown Pattern (`src/server.js`)
**Signal Handler** (lines 203-219):
```javascript
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  mqttService.disconnect();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
```

## 📊 Dashboard & Analytics Patterns

### Dashboard API (`src/routes/dashboardRoutes.js`)
**Overview Statistics Pattern** (lines 7-41):
```javascript
// Parallel data fetching
const [allTvs, allImages] = await Promise.all([
  TV.findAll(),
  Image.findAll()
]);

// Aggregated statistics
const stats = {
  total_tvs: allTvs.length,
  online_tvs: allTvs.filter(tv => tv.status === 'online').length,
  offline_tvs: allTvs.filter(tv => tv.status === 'offline').length,
  total_images: allImages.length,
  active_images: allImages.filter(img => img.status === 'active').length
};

// Enriched TV status with image counts
const tvStatus = allTvs.map(tv => ({
  // ... basic TV info
  assigned_images_count: allImages.filter(img => 
    img.assigned_tvs.includes(tv._id)
  ).length
}));
```

## 🎨 Frontend Patterns

### JavaScript App Architecture (`public/js/app.js`)
**Class-based SPA Pattern** (lines 1-27):
```javascript
class DigitalSignageApp {
    constructor() {
        this.ws = null;
        this.currentSection = 'dashboard';
        this.tvs = [];
        this.images = [];
        this.darkTheme = localStorage.getItem('darkTheme') === 'true';
        this.mqttMessages = { general: [], signage: [] };
        this.init();
    }
}
```

**Event Delegation Pattern** (lines 29-89):
```javascript
// Navigation handling
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const section = link.dataset.section;
        this.switchSection(section);
    });
});

// Modal management
document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
    btn.addEventListener('click', () => this.closeModal());
});
```

**WebSocket Connection Pattern** (lines 91-100):
```javascript
initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => this.updateConnectionStatus(true);
    // ... other handlers
}
```

## 🛠️ Utility Scripts & Tools

### Database Setup Script (`scripts/db-setup.js`)
**Standalone Database Initialization**:
```javascript
#!/usr/bin/env node
const { initializeDatabase } = require('../src/config/database');

async function setupDatabase() {
  try {
    console.log('Setting up CouchDB database...');
    await initializeDatabase();
    console.log('Database setup completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Database setup failed:', error.message);
    process.exit(1);
  }
}
```

### ESLint Configuration (`.eslintrc.js`)
**Node.js Optimized Linting**:
```javascript
module.exports = {
  env: { node: true, es2021: true },
  extends: 'eslint:recommended',
  rules: {
    'no-console': 'off', // Allow console in server code
    'no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }]
  },
  globals: {
    'emit': 'readonly' // CouchDB view function
  }
};
```

## 🔧 Development & Build Patterns

### Environment Configuration
**Environment-based Feature Flags** (from `server.js`):
- Security: Production vs development helmet configuration
- Error Details: Detailed errors in development only
- Git Status: Dirty flag detection in non-production

### Error Response Standardization
**Development vs Production Error Handling** (`server.js` lines 189-195):
```javascript
app.use((err, req, res, _next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});
```

### Server Initialization Pattern (`src/server.js`)
**Sequential Startup with Error Handling** (lines 222-250):
```javascript
async function startServer() {
  try {
    // 1. Initialize database
    await initializeDatabase();
    
    // 2. Connect to MQTT (optional, continues on failure)
    try {
      await mqttService.connect();
    } catch (error) {
      console.error('MQTT connection failed, continuing without MQTT:', error.message);
    }
    
    // 3. Start HTTP server
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}
```

## 🎯 Additional Reuse Opportunities

1. **WebSocket Bridge Pattern**: Extend MQTT-to-WebSocket bridge for other real-time data
2. **Health Check**: Add service-specific health checks (database, MQTT, disk space)
3. **Version API**: Use git-based version pattern for other components
4. **Dashboard Statistics**: Follow parallel fetching + aggregation pattern for new metrics
5. **Graceful Shutdown**: Apply signal handler pattern to other long-running processes
6. **Environment Config**: Use production/development branching for other features
7. **Frontend SPA**: Extend class-based app pattern for new UI components
8. **Setup Scripts**: Follow standalone script pattern for other admin tasks

## 📍 File Locations Summary

- **Server Core**: `src/server.js` - Express setup, WebSocket, graceful shutdown
- **Models**: `src/models/` - TV and Image document management
- **Routes**: `src/routes/` - REST API endpoints and validation
- **Services**: `src/services/` - MQTT communication and pub/sub
- **Middleware**: `src/middleware/` - File upload and processing
- **Config**: `src/config/` - Database connection and setup
- **Scripts**: `scripts/` - Database setup and admin utilities
- **Frontend**: `public/js/` - SPA architecture and WebSocket client
- **Rust Core**: `pi-slideshow-rs/src/` - Slideshow logic and hardware control
- **Linting**: `.eslintrc.js` - Code quality configuration