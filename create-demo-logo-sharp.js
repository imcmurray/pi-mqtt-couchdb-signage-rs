#!/usr/bin/env node

// Create a demo logo using Sharp
const sharp = require('sharp');

async function createDemoLogo() {
  try {
    // Create a simple colored rectangle with transparency
    const logoSvg = `
      <svg width="200" height="100" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#4A90E2;stop-opacity:0.8" />
            <stop offset="100%" style="stop-color:#2C5CB0;stop-opacity:0.8" />
          </linearGradient>
        </defs>
        <rect x="10" y="10" width="180" height="80" rx="10" ry="10" 
              fill="url(#grad1)" stroke="white" stroke-width="2"/>
        <text x="100" y="40" font-family="Arial" font-size="16" font-weight="bold" 
              text-anchor="middle" fill="white">DEMO LOGO</text>
        <text x="100" y="65" font-family="Arial" font-size="12" 
              text-anchor="middle" fill="white">Layer System</text>
      </svg>
    `;

    // Convert SVG to PNG with transparency
    await sharp(Buffer.from(logoSvg))
      .png()
      .toFile('demo-logo.png');

    console.log('✅ Created demo-logo.png (200x100px with transparency)');
    console.log('📍 Logo ready for layer overlay testing');
    
    // Also create a smaller version for corner placement
    await sharp(Buffer.from(logoSvg))
      .resize(150, 75)
      .png()
      .toFile('demo-logo-small.png');
      
    console.log('✅ Created demo-logo-small.png (150x75px for corner overlay)');
    
  } catch (error) {
    console.error('❌ Error creating demo logo:', error);
    process.exit(1);
  }
}

createDemoLogo();