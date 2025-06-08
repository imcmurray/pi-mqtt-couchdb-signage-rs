# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Rust slideshow application designed for digital signage on Raspberry Pi 4. It displays images with smooth animated transitions directly to HDMI monitors without X11 or GUI frameworks. The project includes MQTT integration for remote control, HTTP API for local management, and dynamic image loading from a central management server. It demonstrates cross-compilation from any platform to ARM64 and serves as a complete digital signage endpoint solution.

## Common Commands

- **Cross-compile for Pi**: `./build.sh`
- **Build locally**: `cargo build`
- **Run with MQTT**: `cargo run -- --mqtt-broker mqtt://broker:1883 --couchdb-url http://couchdb:5984`
- **Run standalone**: `cargo run -- --enable-mqtt false`
- **Run with custom TV ID**: `cargo run -- --tv-id living-room-tv`
- **Build for release**: `cargo build --release`
- **Run tests**: `cargo test`
- **Check code without building**: `cargo check`
- **Format code**: `cargo fmt`
- **Lint code**: `cargo clippy`

## Cross-Compilation

- **Target**: `aarch64-unknown-linux-musl` (statically linked ARM64)
- **Build script**: `build.sh` handles cross-compilation setup
- **Dependencies**: MQTT client (`rumqttc`), HTTP server (`warp`), image processing (`image`)
- **Output**: Binary suitable for Raspberry Pi 4 running 64-bit OS

## Architecture

The project implements a complete digital signage solution with these key components:

- **Framebuffer Rendering**: Direct framebuffer access (`/dev/fb0`) for hardware-accelerated display
- **Image Management**: Support for PNG/JPG images with automatic scaling and loading
- **Transition Effects**: 17 different animated transitions (fade, slide, wipe, dissolve, etc.)
- **MQTT Integration**: Real-time remote control via MQTT broker communication
- **HTTP API**: Local REST API for direct TV control and status monitoring
- **Dynamic Loading**: Automatic image sync from CouchDB database
- **Controller Architecture**: Async event-driven design with broadcast channels
- **Performance**: 30 FPS transitions at 1920x1080 resolution (32-bit BGRA)

## Remote Control

### MQTT Topics
- `signage/tv/{tv_id}/command` - Receive commands (play, pause, next, reboot)
- `signage/tv/{tv_id}/status` - Publish status updates
- `signage/tv/{tv_id}/heartbeat` - Health monitoring
- `signage/tv/{tv_id}/image/current` - Current image notifications

### HTTP API Endpoints
- `GET /api/health` - Health check
- `GET /api/status` - Get TV status
- `POST /api/control` - Control slideshow (play, pause, next, previous)
- `PUT /api/config` - Update configuration
- `GET /api/images` - Get image list

## Integration

This TV endpoint integrates with CouchDB and MQTT for:
- Direct database access for image metadata and TV configurations
- Real-time image synchronization via CouchDB attachments
- Remote control capabilities via MQTT messaging  
- Status updates stored directly in CouchDB
- Decoupled architecture without management server dependencies
