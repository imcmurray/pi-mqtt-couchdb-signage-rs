#!/bin/bash

# Build script for Raspberry Pi 4 cross-compilation

echo "Building for Raspberry Pi 4 (ARM64)..."

# Ensure ARM64 cross-compiler is available
if ! command -v aarch64-linux-gnu-gcc &> /dev/null; then
    echo "❌ ARM64 cross-compiler not found. Install with:"
    echo "   sudo pacman -S aarch64-linux-gnu-gcc  # Arch Linux"
    echo "   sudo apt install gcc-aarch64-linux-gnu  # Ubuntu/Debian"
    exit 1
fi

# Ensure .cargo directory exists and has config
mkdir -p .cargo
if [ ! -f .cargo/config.toml ]; then
    echo "📝 Creating Cargo cross-compilation config..."
    cat > .cargo/config.toml << EOF
[target.aarch64-unknown-linux-musl]
linker = "aarch64-linux-gnu-gcc"
EOF
fi

# Set OpenSSL environment variables for cross-compilation
export OPENSSL_STATIC=1

# Try to find OpenSSL using pkg-config, fallback to common paths
if command -v pkg-config &> /dev/null && pkg-config --exists openssl; then
    export OPENSSL_LIB_DIR=$(pkg-config --variable=libdir openssl)
    export OPENSSL_INCLUDE_DIR=$(pkg-config --variable=includedir openssl)
    echo "📦 Using OpenSSL from pkg-config: $OPENSSL_LIB_DIR"
else
    # Fallback paths for different distributions
    if [ -d "/usr/lib" ]; then
        export OPENSSL_LIB_DIR=/usr/lib
    elif [ -d "/usr/lib/x86_64-linux-gnu" ]; then
        export OPENSSL_LIB_DIR=/usr/lib/x86_64-linux-gnu
    fi
    export OPENSSL_INCLUDE_DIR=/usr/include
    echo "📦 Using fallback OpenSSL paths: $OPENSSL_LIB_DIR"
fi

# Build statically linked ARM64 binary using musl
cargo build --target aarch64-unknown-linux-musl --release

if [ $? -eq 0 ]; then
    echo "✅ Cross-compilation successful!"
    echo "📁 Binary location: target/aarch64-unknown-linux-musl/release/pi-slideshow-rs"
    echo "📋 Binary info:"
    file target/aarch64-unknown-linux-musl/release/pi-slideshow-rs
    echo ""
    echo "🚀 Copy to Raspberry Pi and run with: ./pi-slideshow-rs"
else
    echo "❌ Build failed"
    exit 1
fi