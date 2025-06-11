#!/bin/bash

# Test script to verify image reload fix
echo "Testing image reload fix..."
echo "Monitor the logs to verify that 'Loading image for framebuffer' appears only when images change"
echo ""
echo "Starting pi-slideshow-rs with 3 second display duration..."
echo "You should see each image loaded only once, not repeatedly"
echo ""

cd pi-slideshow-rs

# Run with short display duration to see multiple transitions quickly
cargo run -- --delay 3 --enable-mqtt false 2>&1 | grep -E "(Loading image|Advanced to image|Successfully loaded)"