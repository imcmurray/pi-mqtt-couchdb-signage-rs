#!/bin/bash
set -e

# Digital Signage TV Endpoint Installation Script
# Run this script on a Raspberry Pi to install and configure the signage endpoint

echo "🎬 Digital Signage TV Endpoint Installer"
echo "========================================"

# Check if running as pi user
if [ "$USER" != "pi" ]; then
    echo "❌ This script must be run as the 'pi' user"
    echo "Please run: sudo -u pi $0"
    exit 1
fi

# Check for required parameters
MANAGEMENT_SERVER=""
TV_ID=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --server)
            MANAGEMENT_SERVER="$2"
            shift 2
            ;;
        --tv-id)
            TV_ID="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 --server <management-server-ip> [--tv-id <unique-id>]"
            echo ""
            echo "Options:"
            echo "  --server    IP address or hostname of management server"
            echo "  --tv-id     Unique identifier for this TV (defaults to hostname)"
            echo "  --help      Show this help message"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

if [ -z "$MANAGEMENT_SERVER" ]; then
    echo "❌ Management server address is required"
    echo "Usage: $0 --server <management-server-ip> [--tv-id <unique-id>]"
    exit 1
fi

# Use hostname as TV ID if not provided
if [ -z "$TV_ID" ]; then
    TV_ID=$(hostname)
fi

echo "📋 Configuration:"
echo "   Management Server: $MANAGEMENT_SERVER"
echo "   TV ID: $TV_ID"
echo ""

# Create directories
echo "📁 Creating directories..."
sudo mkdir -p /var/signage/images
sudo mkdir -p /home/pi/signage
sudo chown -R pi:pi /var/signage
sudo chown -R pi:pi /home/pi/signage

# Add pi user to video group for framebuffer access
echo "👤 Adding pi user to video group..."
sudo usermod -a -G video pi

# Set framebuffer permissions
echo "🖥️ Setting framebuffer permissions..."
sudo chmod 666 /dev/fb0 2>/dev/null || echo "⚠️  Could not set framebuffer permissions (normal if running remotely)"

# Copy binary (assuming it's in current directory)
if [ -f "./pi-slideshow-rs" ]; then
    echo "📦 Installing binary..."
    cp ./pi-slideshow-rs /home/pi/signage/
    chmod +x /home/pi/signage/pi-slideshow-rs
else
    echo "❌ Binary 'pi-slideshow-rs' not found in current directory"
    echo "Please build the binary first with './build.sh' and copy it here"
    exit 1
fi

# Create systemd service with custom configuration
echo "⚙️ Creating systemd service..."
sudo tee /etc/systemd/system/signage.service > /dev/null << EOF
[Unit]
Description=Digital Signage TV Endpoint ($TV_ID)
Documentation=https://github.com/your-repo/digital-signage-management
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=pi
Group=video
WorkingDirectory=/home/pi/signage
ExecStart=/home/pi/signage/pi-slideshow-rs \\
  --mqtt-broker mqtt://$MANAGEMENT_SERVER:1883 \\
  --couchdb-url http://$MANAGEMENT_SERVER:5984 \\
  --tv-id $TV_ID \\
  --image-dir /var/signage/images \\
  --delay 30 \\
  --transition 1500 \\
  --http-port 8080

# Restart configuration
Restart=always
RestartSec=10
KillMode=mixed
TimeoutStopSec=30

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/signage /tmp
SupplementaryGroups=video

# Environment
Environment=RUST_LOG=info
Environment=RUST_BACKTRACE=1

# Resource limits
MemoryMax=512M
CPUQuota=80%

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and enable service
echo "🔄 Enabling systemd service..."
sudo systemctl daemon-reload
sudo systemctl enable signage.service

# Create log rotation configuration
echo "📝 Setting up log rotation..."
sudo tee /etc/logrotate.d/signage > /dev/null << EOF
/var/log/signage.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
    create 644 pi pi
}
EOF

# Test connectivity
echo "🔍 Testing connectivity to management server..."
if ping -c 1 "$MANAGEMENT_SERVER" > /dev/null 2>&1; then
    echo "✅ Management server is reachable"
else
    echo "⚠️  Warning: Cannot reach management server at $MANAGEMENT_SERVER"
    echo "   Please verify the server address and network connectivity"
fi

# Create uninstall script
echo "🗑️ Creating uninstall script..."
tee /home/pi/signage/uninstall.sh > /dev/null << 'EOF'
#!/bin/bash
echo "🗑️ Uninstalling Digital Signage TV Endpoint..."

# Stop and disable service
sudo systemctl stop signage.service 2>/dev/null || true
sudo systemctl disable signage.service 2>/dev/null || true

# Remove service file
sudo rm -f /etc/systemd/system/signage.service

# Remove log rotation
sudo rm -f /etc/logrotate.d/signage

# Remove directories (ask for confirmation)
echo "Remove signage directories? [y/N]"
read -r response
if [[ "$response" =~ ^[Yy]$ ]]; then
    sudo rm -rf /var/signage
    rm -rf /home/pi/signage
    echo "✅ Directories removed"
else
    echo "📁 Directories preserved"
fi

sudo systemctl daemon-reload
echo "✅ Uninstallation complete"
EOF

chmod +x /home/pi/signage/uninstall.sh

echo ""
echo "🎉 Installation Complete!"
echo "========================"
echo ""
echo "📋 Summary:"
echo "   • Binary installed to: /home/pi/signage/pi-slideshow-rs"
echo "   • Service name: signage.service"
echo "   • TV ID: $TV_ID"
echo "   • Management server: $MANAGEMENT_SERVER"
echo "   • Images directory: /var/signage/images"
echo "   • Local API: http://$(hostname):8080/api/"
echo ""
echo "🚀 Start the service:"
echo "   sudo systemctl start signage"
echo ""
echo "📊 Monitor the service:"
echo "   sudo systemctl status signage"
echo "   sudo journalctl -u signage -f"
echo ""
echo "🔧 Service management:"
echo "   sudo systemctl stop signage      # Stop service"
echo "   sudo systemctl restart signage   # Restart service"
echo "   sudo systemctl disable signage   # Disable auto-start"
echo ""
echo "🗑️ Uninstall:"
echo "   /home/pi/signage/uninstall.sh"
echo ""
echo "⚠️  Note: The service will start automatically on boot."
echo "   You may want to test it manually first with:"
echo "   sudo systemctl start signage"
echo ""