# Digital Signage Management System

## Project Overview
Building a digital signage solution using pi-slideshow-rs on Raspberry Pi endpoints with a centralized management system for 8 TV displays.

## Architecture

### Communication Protocol Strategy
Our system uses a **dual-protocol architecture** optimized for different data types and use cases:

**CouchDB (Persistent Data Protocol):**
- **Purpose**: Long-term storage, complex queries, large binary data
- **Used for**: TV configurations, image metadata, image files (attachments), audit logs  
- **Benefits**: ACID transactions, offline replication, conflict resolution, complex queries
- **Access**: Direct database connections from both management server and TV endpoints

**MQTT (Real-time Messaging Protocol):**
- **Purpose**: Lightweight real-time communication, pub/sub patterns, ephemeral data
- **Used for**: Control commands (play/pause/next), status updates, heartbeats, notifications
- **Benefits**: Low latency, minimal bandwidth, automatic reconnection, QoS levels
- **Access**: Publish/subscribe through central message broker

- Realtime values should use MQTT and persistent storage will use CouchDB

### System Components
- **TV Endpoints**: Raspberry Pi 4 running pi-slideshow-rs with dual CouchDB+MQTT connections
- **Backend**: Node.js/Express with CouchDB database and MQTT broker integration  
- **Communication**: Hybrid CouchDB+MQTT for optimal performance and reliability
- **Frontend**: Web-based admin panel with real-time WebSocket updates

## Technology Stack

**Data Storage & Communication:**
- **Database**: CouchDB (document-based storage, replication, image attachments)
- **Message Broker**: MQTT (lightweight IoT messaging, pub/sub patterns)
- **Backend**: Node.js with Express, WebSocket support for real-time UI updates
- **TV Control**: pi-slideshow-rs with direct CouchDB connection and MQTT client
- **Image Processing**: Sharp for server-side processing, local caching on TV endpoints
- **Security**: Helmet.js, CORS, Joi validation, CouchDB authentication

**Protocol Usage Decision Matrix:**

| Operation Type | Protocol | Rationale |
|----------------|----------|-----------|
| Image uploads | CouchDB | Large binary data, permanent storage, attachment support |
| TV configurations | CouchDB | Persistent settings, complex validation, ACID transactions |
| Image assignments | CouchDB | Relational data, complex queries, referential integrity |
| Play/pause commands | MQTT | Real-time response, ephemeral, fire-and-forget |
| Status updates | MQTT | High frequency, lightweight, pub/sub to dashboard |
| Heartbeats | MQTT | Frequent ping data, automatic cleanup |
| Current image sync | Both | MQTT for real-time notification + CouchDB for persistence |

## Development Commands
- `npm run dev` - Start development server with nodemon
- `npm test` - Run Jest tests
- `npm run lint` - Run ESLint
- `npm run build` - Build for production (Node.js - no build step needed)

## Current Implementation Status
### Completed Components
- Basic Express server structure with middleware
- CouchDB database configuration and models (TV, Image)
- MQTT service integration
- File upload middleware with Sharp image processing
- REST API routes for TVs, images, and dashboard
- Rust-based slideshow controller with HTTP server and MQTT client

### Project Structure
```
src/
├── config/database.js      # CouchDB connection setup
├── controllers/            # Route controllers (to be implemented)
├── middleware/upload.js    # Multer file upload with Sharp processing
├── models/
│   ├── image.js           # Image document model
│   └── tv.js              # TV document model
├── routes/
│   ├── dashboardRoutes.js # Dashboard API endpoints
│   ├── imageRoutes.js     # Image management endpoints
│   └── tvRoutes.js        # TV management endpoints
├── services/mqttService.js # MQTT client service
├── server.js              # Main application entry point
└── utils/                 # Utility functions (to be implemented)

pi-slideshow-rs/
├── src/
│   ├── main.rs                    # Main application entry
│   ├── slideshow_controller.rs    # Core slideshow logic
│   ├── http_server.rs            # REST API server
│   └── mqtt_client.rs            # MQTT communication
└── images/                       # Sample slideshow images

public/
├── index.html            # Admin panel frontend
├── css/style.css        # Frontend styling
└── js/app.js           # Frontend JavaScript
```

## Key Features (Planned)
- Image upload/management per TV
- Real-time TV status dashboard via WebSocket
- Court hearing integration
- Scheduling system
- Bulk operations across multiple TVs
- Image resizing and optimization

## TV Endpoint Structure
Each TV operates with hybrid connectivity for optimal performance:

**Data Connections:**
- **CouchDB**: Direct database connection for image downloads and configuration sync
- **MQTT**: Real-time command/status communication via broker
- **Local Storage**: Cached images in `pi-slideshow-rs/images/` for offline operation

**Communication Patterns:**
- MQTT command topic: `signage/tv/{id}/command` (receive control commands)
- MQTT status topic: `signage/tv/{id}/status` (publish status updates)  
- MQTT heartbeat topic: `signage/tv/{id}/heartbeat` (health monitoring)
- CouchDB queries: Direct database access for images and configuration
- HTTP API: `http://pi-ip:8080/api/` (local control interface)

**Operational Flow:**
1. **Startup**: Connect to both CouchDB and MQTT broker
2. **Image Sync**: Query CouchDB for assigned images, download as attachments
3. **Real-time Control**: Listen for MQTT commands, respond immediately  
4. **Status Reporting**: Publish status via MQTT, persist state in CouchDB
5. **Offline Operation**: Continue slideshow using cached images if network fails

## Dependencies
- **Express**: Web framework
- **nano**: CouchDB client
- **mqtt**: MQTT client
- **multer**: File upload handling
- **sharp**: Image processing
- **ws**: WebSocket support
- **joi**: Input validation
- **helmet**: Security headers

## Development Best Practices
- Don't duplicate code and create duplicate functions that do the same thing with a different name.