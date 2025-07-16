use image::{ImageError, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use crate::Orientation;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LayerType {
    Slideshow,     // Background transitioning images
    StaticOverlay, // Fixed logo/image
    DynamicText,   // Date/time (future implementation)
    Emergency,     // High-priority overlays (future implementation)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl Default for Position {
    fn default() -> Self {
        Self { x: 0, y: 0, width: 0, height: 0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LayerContent {
    ImagePath(String),
    Color(u8, u8, u8, u8),  // RGBA
    Text(String),           // Future implementation
    Empty,                  // No content
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Layer {
    pub id: String,
    pub layer_type: LayerType,
    pub position: Position,
    pub opacity: f32,        // 0.0 - 1.0
    pub priority: u8,        // 0-255, higher = on top
    pub visible: bool,
    pub content: LayerContent,
    pub name: Option<String>, // Human-readable name
}

impl Layer {
    pub fn new(id: String, layer_type: LayerType) -> Self {
        Self {
            id,
            layer_type,
            position: Position::default(),
            opacity: 1.0,
            priority: match layer_type {
                LayerType::Slideshow => 1,
                LayerType::StaticOverlay => 10,
                LayerType::DynamicText => 20,
                LayerType::Emergency => 200,
            },
            visible: true,
            content: LayerContent::Empty,
            name: None,
        }
    }

    pub fn with_image(mut self, image_path: String) -> Self {
        self.content = LayerContent::ImagePath(image_path);
        self
    }

    pub fn with_color(mut self, r: u8, g: u8, b: u8, a: u8) -> Self {
        self.content = LayerContent::Color(r, g, b, a);
        self
    }

    pub fn with_position(mut self, x: u32, y: u32, width: u32, height: u32) -> Self {
        self.position = Position { x, y, width, height };
        self
    }

    pub fn with_opacity(mut self, opacity: f32) -> Self {
        self.opacity = opacity.clamp(0.0, 1.0);
        self
    }

    pub fn with_priority(mut self, priority: u8) -> Self {
        self.priority = priority;
        self
    }

    pub fn with_visibility(mut self, visible: bool) -> Self {
        self.visible = visible;
        self
    }

    pub fn with_name(mut self, name: String) -> Self {
        self.name = Some(name);
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerConfig {
    pub layers: HashMap<String, Layer>,
    pub output_resolution: (u32, u32),
    pub orientation: String,
    pub max_layers: u8,
    pub compositing_timeout_ms: u32,
    pub cache_composites: bool,
}

impl Default for LayerConfig {
    fn default() -> Self {
        Self {
            layers: HashMap::new(),
            output_resolution: (1920, 1080),
            orientation: "landscape".to_string(),
            max_layers: 10,
            compositing_timeout_ms: 5000,
            cache_composites: true,
        }
    }
}

pub struct LayerManager {
    config: Arc<RwLock<LayerConfig>>,
    image_cache: Arc<RwLock<HashMap<String, RgbaImage>>>,
    last_composite: Arc<RwLock<Option<RgbaImage>>>,
    composite_dirty: Arc<RwLock<bool>>,
}

impl LayerManager {
    pub fn new(width: u32, height: u32, orientation: String) -> Self {
        let mut config = LayerConfig::default();
        config.output_resolution = (width, height);
        config.orientation = orientation;

        // Create default slideshow layer
        let slideshow_layer = Layer::new("slideshow".to_string(), LayerType::Slideshow)
            .with_position(0, 0, width, height)
            .with_priority(1)
            .with_name("Background Slideshow".to_string());
        
        config.layers.insert("slideshow".to_string(), slideshow_layer);

        Self {
            config: Arc::new(RwLock::new(config)),
            image_cache: Arc::new(RwLock::new(HashMap::new())),
            last_composite: Arc::new(RwLock::new(None)),
            composite_dirty: Arc::new(RwLock::new(true)),
        }
    }

    pub async fn add_layer(&self, layer: Layer) -> Result<(), String> {
        let mut config = self.config.write().await;
        
        if config.layers.len() >= config.max_layers as usize {
            return Err(format!("Maximum number of layers ({}) reached", config.max_layers));
        }

        // Validate layer position is within bounds
        let (width, height) = config.output_resolution;
        if layer.position.x + layer.position.width > width || 
           layer.position.y + layer.position.height > height {
            return Err("Layer position exceeds output resolution bounds".to_string());
        }

        config.layers.insert(layer.id.clone(), layer);
        *self.composite_dirty.write().await = true;
        Ok(())
    }

    pub async fn remove_layer(&self, id: &str) -> Result<(), String> {
        let mut config = self.config.write().await;
        
        // Don't allow removal of the slideshow layer
        if id == "slideshow" {
            return Err("Cannot remove the slideshow layer".to_string());
        }

        if config.layers.remove(id).is_some() {
            *self.composite_dirty.write().await = true;
            Ok(())
        } else {
            Err(format!("Layer '{}' not found", id))
        }
    }

    pub async fn update_layer(&self, id: &str, layer: Layer) -> Result<(), String> {
        let mut config = self.config.write().await;
        
        if !config.layers.contains_key(id) {
            return Err(format!("Layer '{}' not found", id));
        }

        // Validate layer position is within bounds
        let (width, height) = config.output_resolution;
        if layer.position.x + layer.position.width > width || 
           layer.position.y + layer.position.height > height {
            return Err("Layer position exceeds output resolution bounds".to_string());
        }

        config.layers.insert(id.to_string(), layer);
        *self.composite_dirty.write().await = true;
        Ok(())
    }

    pub async fn set_layer_visibility(&self, id: &str, visible: bool) -> Result<(), String> {
        let mut config = self.config.write().await;
        
        if let Some(layer) = config.layers.get_mut(id) {
            if layer.visible != visible {
                layer.visible = visible;
                *self.composite_dirty.write().await = true;
            }
            Ok(())
        } else {
            Err(format!("Layer '{}' not found", id))
        }
    }

    pub async fn set_layer_opacity(&self, id: &str, opacity: f32) -> Result<(), String> {
        let mut config = self.config.write().await;
        
        if let Some(layer) = config.layers.get_mut(id) {
            let clamped_opacity = opacity.clamp(0.0, 1.0);
            if (layer.opacity - clamped_opacity).abs() > f32::EPSILON {
                layer.opacity = clamped_opacity;
                *self.composite_dirty.write().await = true;
            }
            Ok(())
        } else {
            Err(format!("Layer '{}' not found", id))
        }
    }

    pub async fn get_layer(&self, id: &str) -> Option<Layer> {
        let config = self.config.read().await;
        config.layers.get(id).cloned()
    }

    pub async fn get_all_layers(&self) -> Vec<Layer> {
        let config = self.config.read().await;
        let mut layers: Vec<Layer> = config.layers.values().cloned().collect();
        layers.sort_by_key(|layer| layer.priority);
        layers
    }

    pub async fn get_visible_layers(&self) -> Vec<Layer> {
        let layers = self.get_all_layers().await;
        layers.into_iter().filter(|layer| layer.visible).collect()
    }

    pub async fn update_slideshow_content(&self, image_path: Option<String>) -> Result<(), String> {
        let mut config = self.config.write().await;
        
        if let Some(slideshow_layer) = config.layers.get_mut("slideshow") {
            slideshow_layer.content = match image_path {
                Some(path) => LayerContent::ImagePath(path),
                None => LayerContent::Empty,
            };
            *self.composite_dirty.write().await = true;
            Ok(())
        } else {
            Err("Slideshow layer not found".to_string())
        }
    }

    pub async fn render_composite(&self) -> Result<RgbaImage, String> {
        // Check if we can use cached composite
        let is_dirty = *self.composite_dirty.read().await;
        if !is_dirty {
            if let Some(cached) = self.last_composite.read().await.as_ref() {
                return Ok(cached.clone());
            }
        }

        let config = self.config.read().await;
        let (width, height) = config.output_resolution;
        
        // Create base canvas
        let mut composite = RgbaImage::new(width, height);
        
        // Fill with transparent black
        for pixel in composite.pixels_mut() {
            *pixel = Rgba([0, 0, 0, 0]);
        }

        // Get visible layers sorted by priority (lowest first)
        let mut visible_layers: Vec<Layer> = config.layers
            .values()
            .filter(|layer| layer.visible)
            .cloned()
            .collect();
        visible_layers.sort_by_key(|layer| layer.priority);

        // Render each layer
        for layer in visible_layers {
            if let Err(e) = self.render_layer_onto_composite(&layer, &mut composite).await {
                eprintln!("Warning: Failed to render layer '{}': {}", layer.id, e);
            }
        }

        // Cache the result if caching is enabled
        if config.cache_composites {
            *self.last_composite.write().await = Some(composite.clone());
            *self.composite_dirty.write().await = false;
        }

        Ok(composite)
    }

    async fn render_layer_onto_composite(&self, layer: &Layer, composite: &mut RgbaImage) -> Result<(), String> {
        match &layer.content {
            LayerContent::ImagePath(path) => {
                self.render_image_layer(layer, path, composite).await
            }
            LayerContent::Color(r, g, b, a) => {
                self.render_color_layer(layer, *r, *g, *b, *a, composite).await
            }
            LayerContent::Text(_text) => {
                // Future implementation for text rendering
                Ok(())
            }
            LayerContent::Empty => Ok(()),
        }
    }

    async fn render_image_layer(&self, layer: &Layer, image_path: &str, composite: &mut RgbaImage) -> Result<(), String> {
        // Check cache first
        let cached_image = {
            let cache = self.image_cache.read().await;
            cache.get(image_path).cloned()
        };

        let layer_image = match cached_image {
            Some(img) => img,
            None => {
                // Load and cache image
                let img = self.load_and_process_image(image_path, &layer.position).await?;
                let mut cache = self.image_cache.write().await;
                cache.insert(image_path.to_string(), img.clone());
                img
            }
        };

        // Apply layer to composite with opacity
        self.blend_layer_onto_composite(&layer_image, layer, composite);
        Ok(())
    }

    async fn render_color_layer(&self, layer: &Layer, r: u8, g: u8, b: u8, a: u8, composite: &mut RgbaImage) -> Result<(), String> {
        let layer_color = Rgba([r, g, b, a]);
        
        // Apply color to the layer's position with opacity
        for y in layer.position.y..(layer.position.y + layer.position.height) {
            for x in layer.position.x..(layer.position.x + layer.position.width) {
                if x < composite.width() && y < composite.height() {
                    let final_alpha = (a as f32 * layer.opacity) as u8;
                    let pixel_color = Rgba([r, g, b, final_alpha]);
                    
                    if let Some(existing_pixel) = composite.get_pixel_mut_checked(x, y) {
                        *existing_pixel = self.blend_pixels(*existing_pixel, pixel_color);
                    }
                }
            }
        }
        Ok(())
    }

    async fn load_and_process_image(&self, image_path: &str, position: &Position) -> Result<RgbaImage, String> {
        // Load image
        let img = image::open(image_path)
            .map_err(|e| format!("Failed to load image '{}': {}", image_path, e))?
            .to_rgba8();

        // Scale to fit layer position if needed
        let scaled_img = if img.width() != position.width || img.height() != position.height {
            image::imageops::resize(
                &img,
                position.width,
                position.height,
                image::imageops::FilterType::Lanczos3,
            )
        } else {
            img
        };

        Ok(scaled_img)
    }

    fn blend_layer_onto_composite(&self, layer_image: &RgbaImage, layer: &Layer, composite: &mut RgbaImage) {
        for y in 0..layer_image.height() {
            for x in 0..layer_image.width() {
                let composite_x = layer.position.x + x;
                let composite_y = layer.position.y + y;
                
                if composite_x < composite.width() && composite_y < composite.height() {
                    let layer_pixel = *layer_image.get_pixel(x, y);
                    
                    // Apply layer opacity
                    let alpha_adjusted = (layer_pixel[3] as f32 * layer.opacity) as u8;
                    let adjusted_pixel = Rgba([layer_pixel[0], layer_pixel[1], layer_pixel[2], alpha_adjusted]);
                    
                    if let Some(existing_pixel) = composite.get_pixel_mut_checked(composite_x, composite_y) {
                        *existing_pixel = self.blend_pixels(*existing_pixel, adjusted_pixel);
                    }
                }
            }
        }
    }

    fn blend_pixels(&self, background: Rgba<u8>, foreground: Rgba<u8>) -> Rgba<u8> {
        let bg = [
            background[0] as f32 / 255.0,
            background[1] as f32 / 255.0,
            background[2] as f32 / 255.0,
            background[3] as f32 / 255.0,
        ];
        
        let fg = [
            foreground[0] as f32 / 255.0,
            foreground[1] as f32 / 255.0,
            foreground[2] as f32 / 255.0,
            foreground[3] as f32 / 255.0,
        ];

        // Alpha compositing formula
        let out_alpha = fg[3] + bg[3] * (1.0 - fg[3]);
        
        if out_alpha == 0.0 {
            return Rgba([0, 0, 0, 0]);
        }

        let out_r = (fg[0] * fg[3] + bg[0] * bg[3] * (1.0 - fg[3])) / out_alpha;
        let out_g = (fg[1] * fg[3] + bg[1] * bg[3] * (1.0 - fg[3])) / out_alpha;
        let out_b = (fg[2] * fg[3] + bg[2] * bg[3] * (1.0 - fg[3])) / out_alpha;

        Rgba([
            (out_r * 255.0) as u8,
            (out_g * 255.0) as u8,
            (out_b * 255.0) as u8,
            (out_alpha * 255.0) as u8,
        ])
    }

    pub async fn clear_cache(&self) {
        self.image_cache.write().await.clear();
        *self.last_composite.write().await = None;
        *self.composite_dirty.write().await = true;
    }

    pub async fn get_config(&self) -> LayerConfig {
        self.config.read().await.clone()
    }

    pub async fn update_config(&self, config: LayerConfig) -> Result<(), String> {
        // Validate config
        if config.layers.len() > config.max_layers as usize {
            return Err(format!("Configuration contains more layers ({}) than maximum allowed ({})", 
                config.layers.len(), config.max_layers));
        }

        // Ensure slideshow layer exists
        if !config.layers.contains_key("slideshow") {
            return Err("Configuration must contain a slideshow layer".to_string());
        }

        *self.config.write().await = config;
        *self.composite_dirty.write().await = true;
        Ok(())
    }

    pub async fn get_cache_stats(&self) -> (usize, usize) {
        let cache = self.image_cache.read().await;
        let cached_items = cache.len();
        let memory_usage = cache.values()
            .map(|img| (img.width() * img.height() * 4) as usize)
            .sum();
        (cached_items, memory_usage)
    }
}