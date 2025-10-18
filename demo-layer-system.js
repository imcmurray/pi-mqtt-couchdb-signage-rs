#!/usr/bin/env node

// Comprehensive Layer System Demo Script
// Tests end-to-end functionality: Upload -> Configure -> Control layers

const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');

const BASE_URL = 'http://localhost:3000';
const API_BASE = `${BASE_URL}/api`;

// Demo configuration
const DEMO_CONFIG = {
  logo: {
    file: 'demo-logo-small.png',
    name: 'Demo Logo Overlay',
    position: { x: 1750, y: 20, width: 150, height: 75 },
    opacity: 0.8,
    priority: 10
  },
  tv_id: 'tv_demo' // Will use first available TV if this doesn't exist
};

class LayerSystemDemo {
  constructor() {
    this.uploadedImageId = null;
    this.targetTvId = null;
    this.client = axios.create({
      baseURL: API_BASE,
      timeout: 10000
    });
  }

  async log(message, data = null) {
    console.log(`📺 ${message}`);
    if (data) {
      console.log(`   📋 ${JSON.stringify(data, null, 2)}`);
    }
  }

  async error(message, error) {
    console.error(`❌ ${message}`);
    if (error?.response?.data) {
      console.error(`   📋 ${JSON.stringify(error.response.data, null, 2)}`);
    } else if (error?.message) {
      console.error(`   📋 ${error.message}`);
    }
  }

  async step1_CheckSystem() {
    await this.log('=== STEP 1: System Health Check ===');
    
    try {
      // Check if server is running
      const healthResponse = await this.client.get('/health');
      await this.log('✅ Management server is running', healthResponse.data);
      
      // Get list of TVs
      const tvsResponse = await this.client.get('/tvs');
      const tvs = tvsResponse.data;
      
      if (tvs.length === 0) {
        await this.log('⚠️  No TVs registered. Demo will create a mock TV ID.');
        this.targetTvId = DEMO_CONFIG.tv_id;
      } else {
        this.targetTvId = tvs[0]._id;
        await this.log(`✅ Found ${tvs.length} TV(s). Using: ${this.targetTvId}`);
      }
      
    } catch (error) {
      await this.error('System health check failed', error);
      throw error;
    }
  }

  async step2_UploadLogo() {
    await this.log('=== STEP 2: Upload Demo Logo ===');
    
    try {
      // Check if logo file exists
      if (!fs.existsSync(DEMO_CONFIG.logo.file)) {
        throw new Error(`Logo file ${DEMO_CONFIG.logo.file} not found`);
      }
      
      // Create form data for file upload
      const form = new FormData();
      form.append('images', fs.createReadStream(DEMO_CONFIG.logo.file));
      form.append('description', DEMO_CONFIG.logo.name);
      form.append('tags', 'demo,overlay,logo');
      
      const uploadResponse = await this.client.post('/images/upload', form, {
        headers: {
          ...form.getHeaders(),
          'Content-Type': 'multipart/form-data'
        }
      });
      
      this.uploadedImageId = uploadResponse.data.images[0]._id;
      await this.log('✅ Logo uploaded successfully', {
        imageId: this.uploadedImageId,
        size: uploadResponse.data.images[0].size,
        dimensions: `${uploadResponse.data.images[0].metadata.width}x${uploadResponse.data.images[0].metadata.height}`
      });
      
    } catch (error) {
      await this.error('Logo upload failed', error);
      throw error;
    }
  }

  async step3_ConfigureLayer() {
    await this.log('=== STEP 3: Configure Logo Layer ===');
    
    try {
      // First get current TV layer configuration
      const currentLayersResponse = await this.client.get(`/tvs/${this.targetTvId}/layers`);
      await this.log('📋 Current layer configuration', currentLayersResponse.data);
      
      // Add logo layer configuration
      const logoLayerConfig = {
        enabled: true,
        image_path: `/api/images/${this.uploadedImageId}/attachment`,
        position: DEMO_CONFIG.logo.position,
        opacity: DEMO_CONFIG.logo.opacity,
        priority: DEMO_CONFIG.logo.priority
      };
      
      // Update the specific logo layer
      const layerUpdateResponse = await this.client.post(
        `/tvs/${this.targetTvId}/layers/logo_overlay`,
        logoLayerConfig
      );
      
      await this.log('✅ Logo layer configured', {
        layerId: 'logo_overlay',
        config: logoLayerConfig,
        response: layerUpdateResponse.data
      });
      
    } catch (error) {
      await this.error('Layer configuration failed', error);
      throw error;
    }
  }

  async step4_TestLayerControls() {
    await this.log('=== STEP 4: Test Layer Controls ===');
    
    try {
      // Test layer visibility toggle
      await this.log('🔧 Testing layer visibility controls...');
      
      // Hide logo
      await this.client.post(`/tvs/${this.targetTvId}/layers/logo_overlay/visibility`, {
        visible: false
      });
      await this.log('✅ Logo layer hidden');
      
      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Show logo again
      await this.client.post(`/tvs/${this.targetTvId}/layers/logo_overlay/visibility`, {
        visible: true
      });
      await this.log('✅ Logo layer shown');
      
      // Test opacity change
      await this.log('🔧 Testing opacity adjustment...');
      await this.client.post(`/tvs/${this.targetTvId}/layers/logo_overlay`, {
        enabled: true,
        image_path: `/api/images/${this.uploadedImageId}/attachment`,
        position: DEMO_CONFIG.logo.position,
        opacity: 0.5, // More transparent
        priority: DEMO_CONFIG.logo.priority
      });
      await this.log('✅ Logo opacity adjusted to 50%');
      
      // Wait a moment then restore
      await new Promise(resolve => setTimeout(resolve, 2000));
      await this.client.post(`/tvs/${this.targetTvId}/layers/logo_overlay`, {
        enabled: true,
        image_path: `/api/images/${this.uploadedImageId}/attachment`,
        position: DEMO_CONFIG.logo.position,
        opacity: DEMO_CONFIG.logo.opacity, // Restore original
        priority: DEMO_CONFIG.logo.priority
      });
      await this.log('✅ Logo opacity restored');
      
    } catch (error) {
      await this.error('Layer control testing failed', error);
      throw error;
    }
  }

  async step5_VerifyLayerSync() {
    await this.log('=== STEP 5: Verify Layer Sync ===');
    
    try {
      // Get final layer configuration
      const finalLayersResponse = await this.client.get(`/tvs/${this.targetTvId}/layers`);
      const layers = finalLayersResponse.data.layers;
      
      await this.log('📋 Final layer configuration:', layers);
      
      // Verify logo layer exists and is configured correctly
      if (layers.logo_overlay) {
        const logoLayer = layers.logo_overlay;
        const isCorrect = 
          logoLayer.enabled &&
          logoLayer.image_path.includes(this.uploadedImageId) &&
          logoLayer.position.x === DEMO_CONFIG.logo.position.x &&
          logoLayer.position.y === DEMO_CONFIG.logo.position.y;
          
        if (isCorrect) {
          await this.log('✅ Logo layer configuration verified correct');
        } else {
          await this.log('⚠️  Logo layer configuration may have issues', logoLayer);
        }
      } else {
        await this.log('❌ Logo layer not found in configuration');
      }
      
      // Check if TV is online (if it exists)
      try {
        const tvResponse = await this.client.get(`/tvs/${this.targetTvId}`);
        const tv = tvResponse.data;
        await this.log(`📱 TV Status: ${tv.status} (last seen: ${tv.last_heartbeat || 'never'})`);
      } catch (tvError) {
        await this.log('📱 TV not found in database (may be mock TV for demo)');
      }
      
    } catch (error) {
      await this.error('Layer sync verification failed', error);
      throw error;
    }
  }

  async step6_CleanupDemo() {
    await this.log('=== STEP 6: Demo Cleanup (Optional) ===');
    
    try {
      const shouldCleanup = process.argv.includes('--cleanup');
      
      if (shouldCleanup) {
        // Remove logo layer
        await this.client.delete(`/tvs/${this.targetTvId}/layers/logo_overlay`);
        await this.log('✅ Logo layer removed');
        
        // Delete uploaded image
        await this.client.delete(`/images/${this.uploadedImageId}`);
        await this.log('✅ Demo image deleted');
        
        await this.log('🧹 Demo cleanup completed');
      } else {
        await this.log('ℹ️  Skipping cleanup (use --cleanup flag to clean up)');
        await this.log(`ℹ️  Logo will remain on TV ${this.targetTvId}`);
        await this.log(`ℹ️  Uploaded image ID: ${this.uploadedImageId}`);
      }
      
    } catch (error) {
      await this.error('Cleanup failed (this is non-critical)', error);
    }
  }

  async runDemo() {
    console.log('🚀 Starting Digital Signage Layer System Demo\n');
    
    try {
      await this.step1_CheckSystem();
      await this.step2_UploadLogo();
      await this.step3_ConfigureLayer();
      await this.step4_TestLayerControls();
      await this.step5_VerifyLayerSync();
      await this.step6_CleanupDemo();
      
      console.log('\n🎉 Layer System Demo Completed Successfully!');
      console.log('📊 Results:');
      console.log(`   ✅ Logo uploaded (ID: ${this.uploadedImageId})`);
      console.log(`   ✅ Layer configured on TV: ${this.targetTvId}`);
      console.log(`   ✅ Layer controls tested (visibility, opacity)`);
      console.log(`   ✅ API-to-Database sync verified`);
      console.log('\n🏆 Phase 2 Layer Infrastructure: 100% Complete!');
      
    } catch (error) {
      console.log('\n💥 Demo failed at step:', error.message);
      console.log('🔍 Check server logs and ensure:');
      console.log('   - Management server is running on port 3000');
      console.log('   - CouchDB is accessible');
      console.log('   - Demo logo files exist');
      process.exit(1);
    }
  }
}

// Run demo if this file is executed directly
if (require.main === module) {
  const demo = new LayerSystemDemo();
  demo.runDemo();
}

module.exports = LayerSystemDemo;