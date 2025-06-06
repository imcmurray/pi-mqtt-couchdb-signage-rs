# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Rust visual demonstration project that successfully displays content directly to HDMI monitors on Raspberry Pi 4 without X11 or GUI frameworks. The project uses direct framebuffer access (`/dev/fb0`) to render mathematical visualizations including mandala patterns, flowing waves, and particle systems. It demonstrates cross-compilation from any platform to ARM64 and serves as a template for creating graphics applications on Raspberry Pi.

## Common Commands

- **Cross-compile for Pi**: `./build.sh`
- **Build locally**: `cargo build`
- **Run locally**: `cargo run` (creates framebuffer_output.raw file)
- **Build for release**: `cargo build --release`
- **Run tests**: `cargo test`
- **Check code without building**: `cargo check`
- **Format code**: `cargo fmt`
- **Lint code**: `cargo clippy`

## Cross-Compilation

- **Target**: `aarch64-unknown-linux-musl` (statically linked ARM64)
- **Build script**: `build.sh` handles cross-compilation setup
- **Dependencies**: `fastrand` for randomization, `libc` for system calls
- **Output**: Binary suitable for Raspberry Pi 4 running 64-bit OS

## Architecture

The project implements direct framebuffer graphics rendering with these key components:

- **SimpleFramebuffer**: Custom framebuffer abstraction handling BGRA pixel format
- **Color system**: HSV color space with conversion to RGB for smooth gradients
- **Visualization modes**: Three mathematical drawing functions that cycle every 10 seconds:
  - `draw_mandala_pattern()`: Geometric spirals with radial symmetry
  - `draw_flowing_waves()`: Layered sine wave animations  
  - `draw_particle_field()`: Orbital particle systems with trails
- **Framebuffer access**: Direct writes to `/dev/fb0` with fallback to file output
- **Performance**: Targets 30 FPS at 1920x1080 resolution (32-bit BGRA)
