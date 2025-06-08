# Pi MQTT CouchDB Signage 🦀📺

A Rust-powered Raspberry Pi endpoint for digital signage systems. Part of a hybrid signage management platform featuring MQTT real-time control, CouchDB data synchronization, HTTP API, and professional animated transitions. Designed for enterprise digital signage networks with centralized management.

## ✨ Key Features

### 🎬 Visual Excellence
- **Direct Framebuffer Rendering**: Hardware-accelerated graphics without X11
- **17 Transition Effects**: Professional animated transitions (fade, slide, wipe, dissolve, etc.)
- **Real-time Rendering**: 30 FPS transitions at 1920x1080 resolution
- **Image Format Support**: PNG, JPG, JPEG with automatic scaling

### 🔌 Connectivity & Control
- **MQTT Integration**: Real-time remote control via MQTT broker
- **CouchDB Sync**: Direct database access for images and configurations
- **HTTP REST API**: Local control interface on port 8080
- **Hybrid Architecture**: Combines MQTT real-time control with CouchDB persistence
- **Management Platform**: Seamless integration with Node.js management server

### 🏢 Enterprise Features
- **Automatic TV ID Generation**: Hostname-based or UUID fallback identification
- **Health Monitoring**: Heartbeat and status reporting every 30 seconds
- **Error Recovery**: Automatic reconnection and graceful error handling
- **Configuration Management**: Remote config updates for timing and effects

## 🚀 Quick Start

### For Digital Signage Systems

```bash
# Cross-compile for Raspberry Pi
./build.sh

# Deploy to TV endpoint
scp target/aarch64-unknown-linux-musl/release/pi-mqtt-couchdb-signage-rs pi@tv-lobby.local:~/

# Run with full CouchDB + MQTT integration
ssh pi@tv-lobby.local
sudo ./pi-mqtt-couchdb-signage-rs \
  --mqtt-broker mqtt://management-server:1883 \
  --couchdb-url http://management-server:5984 \
  --tv-id lobby-display \
  --image-dir /var/signage/images \
  --http-port 8080
```

### For Standalone Use

```bash
# Build and run locally
cargo build
cargo run -- --enable-mqtt false --image-dir ./sample-images

# Or on Raspberry Pi without management server
sudo ./pi-mqtt-couchdb-signage-rs --enable-mqtt false --delay 10 --transition 800
```

## 🎛️ Command Line Interface

### Digital Signage Mode (Default)
```bash
./pi-mqtt-couchdb-signage-rs \
  --mqtt-broker mqtt://server:1883 \      # MQTT broker URL
  --couchdb-url http://server:5984 \       # CouchDB database URL
  --tv-id conference-room-a \              # Unique TV identifier
  --image-dir /var/signage \               # Local image storage
  --delay 30 \                             # Display duration (seconds)
  --transition 1500 \                      # Transition time (ms)
  --http-port 8080                         # Local API port
```

### Standalone Mode
```bash
./pi-mqtt-couchdb-signage-rs \
  --enable-mqtt false \                    # Disable MQTT
  --image-dir /home/pi/photos \            # Local image directory
  --delay 15 \                             # 15 second display
  --transition 1000                        # 1 second transitions
```

### Command Line Options

| Option | Description | Default | Example |
|--------|-------------|---------|---------|
| `--mqtt-broker` | MQTT broker URL | `mqtt://localhost:1883` | `mqtt://signage.company.com:1883` |
| `--couchdb-url` | CouchDB database URL | `http://localhost:5984` | `http://signage.company.com:5984` |
| `--tv-id` | Unique TV identifier | Auto-generated | `lobby-tv`, `room-101` |
| `--image-dir` | Local image directory | `.` | `/var/signage/images` |
| `--delay` | Display duration (seconds) | `30` | `15`, `60` |
| `--transition` | Transition duration (ms) | `1500` | `800`, `2000` |
| `--framebuffer` | Framebuffer device | `/dev/fb0` | `/dev/fb1` |
| `--enable-mqtt` | Enable MQTT control | `true` | `false` |
| `--http-port` | Local HTTP API port | `8080` | `9000` |

## 📡 Remote Control

### MQTT Topics

**Commands (Received):**
```bash
signage/tv/{tv_id}/command              # Control commands
```

**Status Updates (Published):**
```bash
signage/tv/{tv_id}/status               # TV status
signage/tv/{tv_id}/heartbeat            # Health monitoring
signage/tv/{tv_id}/image/current        # Current image
signage/tv/{tv_id}/error                # Error reports
```

### Available Commands

```json
// Play slideshow
{"command": "play", "payload": {}, "timestamp": "2024-01-01T12:00:00Z"}

// Pause slideshow  
{"command": "pause", "payload": {}, "timestamp": "2024-01-01T12:00:00Z"}

// Next image
{"command": "next", "payload": {}, "timestamp": "2024-01-01T12:00:00Z"}

// Previous image
{"command": "previous", "payload": {}, "timestamp": "2024-01-01T12:00:00Z"}

// Update image list
{
  "command": "update_images",
  "payload": {
    "images": [
      {"id": "img1", "path": "/var/signage/img1.jpg", "order": 0, "url": "http://server/uploads/img1.jpg"},
      {"id": "img2", "path": "/var/signage/img2.jpg", "order": 1, "url": "http://server/uploads/img2.jpg"}
    ]
  },
  "timestamp": "2024-01-01T12:00:00Z"
}

// Update configuration
{
  "command": "update_config",
  "payload": {
    "display_duration": 20000,
    "transition_duration": 1000,
    "transition_effect": "fade"
  },
  "timestamp": "2024-01-01T12:00:00Z"
}

// Reboot system
{"command": "reboot", "payload": {}, "timestamp": "2024-01-01T12:00:00Z"}
```

### HTTP REST API

**Local Control Interface (port 8080):**

```bash
# Health check
curl http://tv-endpoint:8080/api/health

# Get status
curl http://tv-endpoint:8080/api/status

# Control slideshow
curl -X POST http://tv-endpoint:8080/api/control \
  -H "Content-Type: application/json" \
  -d '{"action": "play"}'

# Update configuration  
curl -X PUT http://tv-endpoint:8080/api/config \
  -H "Content-Type: application/json" \
  -d '{"display_duration": 20000, "transition_duration": 1000}'

# Get image list
curl http://tv-endpoint:8080/api/images
```

## 🎨 Transition Effects

### Available Effects

| Effect | Description | Visual Style |
|--------|-------------|--------------|
| **Fade** | Smooth opacity blend | Classic crossfade |
| **Dissolve** | Random pixel transition | Organic texture |
| **Slide Left/Right/Up/Down** | Directional movement | Clean geometric |
| **Wipe Left/Right/Up/Down** | Progressive reveal | Professional |
| **Circular Wipe** | Expanding circle | Dynamic center-out |
| **Diagonal Wipe** | Corner-to-corner reveal | Modern angular |
| **Pixelate** | Block-based transition | Digital glitch style |
| **Morph** | Wave distortion blend | Fluid artistic |
| **Bounce** | Elastic easing | Playful energy |
| **Elastic** | Spring-like motion | Smooth organic |
| **Ease-In/Out/InOut** | Acceleration curves | Professional timing |

### Custom Transition Development

Add new effects by extending the `TransitionType` enum:

```rust
#[derive(Debug, Clone)]
enum TransitionType {
    // ... existing effects
    CustomEffect,
}

impl ImageManager {
    fn create_custom_transition(
        &self,
        img1: &RgbaImage,
        img2: &RgbaImage,
        progress: f32,
        result: &mut RgbaImage,
    ) {
        // Your custom transition logic
        // progress: 0.0 (start) to 1.0 (end)
        for y in 0..img1.height() {
            for x in 0..img1.width() {
                // Implement your pixel blending algorithm
                let pixel = blend_algorithm(
                    img1.get_pixel(x, y),
                    img2.get_pixel(x, y),
                    progress
                );
                result.put_pixel(x, y, pixel);
            }
        }
    }
}
```

## 🏗️ Architecture

### Core Components

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  MQTT Client    │◄──►│ Slideshow        │◄──►│ HTTP Server     │
│  (rumqttc)      │    │ Controller       │    │ (warp)          │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Image Manager   │◄──►│ Framebuffer      │◄──►│ File System     │
│ (loading/cache) │    │ (rendering)      │    │ (watching)      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Async Architecture
- **Tokio Runtime**: Full async/await support for network operations
- **Broadcast Channels**: Command distribution between components  
- **RwLock Synchronization**: Thread-safe state management
- **MPSC Channels**: Status reporting and event handling

### Performance Optimizations
- **Direct Memory Mapping**: Zero-copy framebuffer access when possible
- **Chunked Transfers**: Efficient large image rendering
- **Real-time Transitions**: Mathematical calculations at 30 FPS
- **Automatic Reconnection**: Robust network error recovery

## 🛠️ Development

### Cross-Compilation for Raspberry Pi

```bash
# Install toolchain
rustup target add aarch64-unknown-linux-musl
sudo apt install gcc-aarch64-linux-gnu  # Ubuntu/Debian

# Or on macOS
brew tap messense/macos-cross-toolchains  
brew install aarch64-unknown-linux-musl

# Build
./build.sh
```

### Local Development & Testing

```bash
# Build for local testing
cargo build

# Run with sample images (creates framebuffer_output.raw)
mkdir sample-images
cp *.png sample-images/
cargo run -- --image-dir sample-images --enable-mqtt false

# Test MQTT integration (requires broker)
cargo run -- --mqtt-broker mqtt://localhost:1883 --tv-id test-tv

# Run tests
cargo test

# Format and lint
cargo fmt
cargo clippy
```

### Project Structure

```
pi-mqtt-couchdb-signage-rs/
├── Cargo.toml                 # Dependencies and build config
├── build.sh                   # Cross-compilation script
├── src/
│   ├── main.rs               # Application entry point
│   ├── mqtt_client.rs        # MQTT integration
│   ├── couchdb_client.rs     # CouchDB database client
│   ├── slideshow_controller.rs # Control logic and state
│   └── http_server.rs        # REST API server
├── CLAUDE.md                 # AI development context
└── README.md                 # This documentation
```

## 🔧 Deployment

### Raspberry Pi Setup

```bash
# Enable framebuffer access
sudo usermod -a -G video pi

# Install dependencies (minimal Pi OS)
sudo apt update
sudo apt install libc6

# Copy binary
scp target/aarch64-unknown-linux-musl/release/pi-mqtt-couchdb-signage-rs pi@pi:~/

# Create systemd service
sudo tee /etc/systemd/system/signage.service > /dev/null <<EOF
[Unit]
Description=Pi MQTT CouchDB Signage Endpoint
After=network.target

[Service]
Type=simple
User=pi
ExecStart=/home/pi/pi-mqtt-couchdb-signage-rs --mqtt-broker mqtt://server:1883 --couchdb-url http://server:5984 --tv-id %H
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
sudo systemctl enable signage
sudo systemctl start signage
```

### Production Configuration

```bash
# Create dedicated image directory
sudo mkdir -p /var/signage/images
sudo chown pi:pi /var/signage/images

# Configure log rotation
sudo tee /etc/logrotate.d/signage > /dev/null <<EOF
/var/log/signage.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
}
EOF

# Monitor service
sudo journalctl -u signage -f
```

## 🔍 Troubleshooting

### Common Issues

**Display Problems:**
```bash
# Check framebuffer permissions
ls -la /dev/fb0
sudo chmod 666 /dev/fb0  # Temporary fix

# Verify HDMI output
/opt/vc/bin/tvservice -s
/opt/vc/bin/vcgencmd display_power 1
```

**Network Connectivity:**
```bash
# Test MQTT connection
mosquitto_pub -h mqtt-broker -t test -m "hello"

# Test HTTP connectivity  
curl -v http://management-server:3000/api/health

# Check DNS resolution
nslookup management-server
```

**Performance Issues:**
```bash
# Monitor system resources
htop
iostat -x 1

# Check temperature throttling
/opt/vc/bin/vcgencmd measure_temp
/opt/vc/bin/vcgencmd get_throttled
```

### Debug Logging

```bash
# Enable verbose logging
RUST_LOG=debug ./pi-mqtt-couchdb-signage-rs

# Monitor MQTT traffic
mosquitto_sub -h broker -t "signage/tv/+/+"

# Check system logs
sudo journalctl -u signage -n 50
```

## 📚 Integration Examples

### Custom Content Sources

```rust
// Add weather data integration
async fn fetch_weather_display() -> Result<RgbaImage, Box<dyn Error>> {
    let weather = reqwest::get("http://api.weather.com/current")
        .await?.json::<WeatherData>().await?;
    
    // Generate image with weather information
    generate_weather_image(weather)
}

// Add calendar integration  
async fn fetch_calendar_events() -> Result<Vec<CalendarEvent>, Box<dyn Error>> {
    // Fetch from Google Calendar, Outlook, etc.
    // Return events for display
}
```

### Hardware Integration

```rust
// GPIO sensor integration
use rppal::gpio::{Gpio, InputPin};

async fn setup_motion_sensor() -> Result<InputPin, Box<dyn Error>> {
    let gpio = Gpio::new()?;
    let pin = gpio.get(18)?.into_input_pulldown();
    Ok(pin)
}

// Camera integration
use v4l::prelude::*;

async fn capture_live_feed() -> Result<RgbaImage, Box<dyn Error>> {
    // Capture from camera and convert to display format
}
```

## 🤝 Contributing

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/new-transition`)
3. **Add** your changes with tests
4. **Test** on actual Raspberry Pi hardware
5. **Submit** a pull request

### Development Guidelines

- **Performance First**: Maintain 30 FPS during transitions
- **Error Handling**: All network operations must have timeout and retry logic
- **Memory Safety**: Use Rust's ownership system to prevent memory leaks
- **Documentation**: Add rustdoc comments for public APIs
- **Testing**: Include unit tests for new transition effects

## 📄 License

MIT License - See [LICENSE](LICENSE) file for details.

---

🎨 **Power your digital signage network with Rust performance!** 🦀📺