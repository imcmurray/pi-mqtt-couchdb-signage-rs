#!/usr/bin/env node

// Simple script to create a demo logo using Canvas API
// This creates a transparent PNG with "DEMO LOGO" text

const fs = require('fs');
const { createCanvas } = require('canvas');

// Create canvas for logo
const width = 200;
const height = 100;
const canvas = createCanvas(width, height);
const ctx = canvas.getContext('2d');

// Set transparent background
ctx.clearRect(0, 0, width, height);

// Create a semi-transparent rounded rectangle background
ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
ctx.roundRect(10, 10, width - 20, height - 20, 10);
ctx.fill();

// Add white border
ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
ctx.lineWidth = 2;
ctx.roundRect(10, 10, width - 20, height - 20, 10);
ctx.stroke();

// Add text
ctx.fillStyle = 'white';
ctx.font = 'bold 16px Arial';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('DEMO LOGO', width / 2, height / 2 - 8);

// Add subtitle
ctx.font = '12px Arial';
ctx.fillText('Layer System', width / 2, height / 2 + 12);

// Save as PNG
const buffer = canvas.toBuffer('image/png');
fs.writeFileSync('demo-logo.png', buffer);

console.log('✅ Created demo-logo.png (200x100px with transparency)');
console.log('📍 Logo ready for layer overlay testing');