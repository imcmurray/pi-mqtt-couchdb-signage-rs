use image::{Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use crate::layer_animation::{AnimationState, AnimationType, AnimationValue};
use fontdue::{Font, FontSettings};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LayerType {
    Slideshow,     // Background transitioning images
    StaticOverlay, // Fixed logo/image
    DynamicText,   // Date/time (future implementation)
    Emergency,     // High-priority overlays (future implementation)
    DataRow,       // Individual data row for multi-layer display
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
    DataRow {               // Data row content
        text: String,
        background_color: (u8, u8, u8, u8),
        text_color: (u8, u8, u8, u8),
        font_size: u32,
        alignment: String,  // left, center, right
    },
    Empty,                  // No content
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Layer {
    pub id: String,
    pub layer_type: LayerType,
    pub position: Position,
    pub target_position: Option<Position>, // For animated moves
    pub opacity: f32,        // 0.0 - 1.0
    pub priority: u8,        // 0-255, higher = on top
    pub visible: bool,
    pub content: LayerContent,
    pub name: Option<String>, // Human-readable name
    pub animation_state: Option<AnimationState>, // Current animation
}

impl Layer {
    pub fn new(id: String, layer_type: LayerType) -> Self {
        let priority = match layer_type {
            LayerType::Slideshow => 1,
            LayerType::StaticOverlay => 10,
            LayerType::DynamicText => 20,
            LayerType::DataRow => 15,
            LayerType::Emergency => 200,
        };
        
        Self {
            id,
            layer_type,
            position: Position::default(),
            target_position: None,
            opacity: 1.0,
            priority,
            visible: true,
            content: LayerContent::Empty,
            name: None,
            animation_state: None,
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

    /// Builder for visibility (for future API)
    #[allow(dead_code)]
    pub fn with_visibility(mut self, visible: bool) -> Self {
        self.visible = visible;
        self
    }

    pub fn with_name(mut self, name: String) -> Self {
        self.name = Some(name);
        self
    }
    
    /// Builder for data row content (for future data row feature)
    #[allow(dead_code)]
    pub fn with_data_row(mut self, text: String, bg_color: (u8, u8, u8, u8), text_color: (u8, u8, u8, u8), font_size: u32, alignment: String) -> Self {
        self.content = LayerContent::DataRow {
            text,
            background_color: bg_color,
            text_color,
            font_size,
            alignment,
        };
        self
    }
    
    // Animation methods
    pub fn start_slide_up(&mut self, distance: f32, duration_ms: u64) {
        let y = self.position.y as f32;
        self.animation_state = Some(AnimationState::slide_up(y, distance, duration_ms));
    }
    
    pub fn start_slide_down(&mut self, distance: f32, duration_ms: u64) {
        let y = self.position.y as f32;
        self.animation_state = Some(AnimationState::slide_down(y, distance, duration_ms));
    }
    
    pub fn start_slide_left(&mut self, distance: f32, duration_ms: u64) {
        let x = self.position.x as f32;
        self.animation_state = Some(AnimationState::slide_left(x, distance, duration_ms));
    }
    
    pub fn start_slide_right(&mut self, distance: f32, duration_ms: u64) {
        let x = self.position.x as f32;
        self.animation_state = Some(AnimationState::slide_right(x, distance, duration_ms));
    }
    
    pub fn start_fade_in(&mut self, duration_ms: u64) {
        self.animation_state = Some(AnimationState::fade_in(duration_ms));
        self.visible = true;
    }
    
    pub fn start_fade_out(&mut self, duration_ms: u64) {
        self.animation_state = Some(AnimationState::fade_out(duration_ms));
    }
    
    /// Start position animation (for future use)
    #[allow(dead_code)]
    pub fn start_move_to(&mut self, to_x: u32, to_y: u32, duration_ms: u64) {
        let from_x = self.position.x as f32;
        let from_y = self.position.y as f32;
        self.target_position = Some(Position {
            x: to_x,
            y: to_y,
            width: self.position.width,
            height: self.position.height,
        });
        self.animation_state = Some(AnimationState::move_to(from_x, from_y, to_x as f32, to_y as f32, duration_ms));
    }
    
    pub fn update_animation(&mut self) -> bool {
        if let Some(ref mut anim) = self.animation_state {
            if anim.update() {
                // Animation still in progress, update position/opacity based on animation
                match anim.get_current_value() {
                    AnimationValue::Position { x, y } => {
                        match anim.animation_type {
                            AnimationType::SlideUp | AnimationType::SlideDown => {
                                self.position.y = y as u32;
                            }
                            AnimationType::SlideLeft | AnimationType::SlideRight => {
                                self.position.x = x as u32;
                            }
                            AnimationType::Move => {
                                self.position.x = x as u32;
                                self.position.y = y as u32;
                            }
                            _ => {}
                        }
                    }
                    AnimationValue::Opacity(o) => {
                        self.opacity = o;
                        if anim.animation_type == AnimationType::FadeOut && o <= 0.01 {
                            self.visible = false;
                        }
                    }
                    _ => {}
                }
                true
            } else {
                // Animation completed
                if let Some(target) = &self.target_position {
                    self.position = target.clone();
                    self.target_position = None;
                }
                self.animation_state = None;
                false
            }
        } else {
            false
        }
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
    font_cache: Arc<RwLock<HashMap<String, Font>>>,
    emoji_font_cache: Arc<RwLock<Option<Font>>>,
    transition_frame: Arc<RwLock<Option<RgbaImage>>>,
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
            font_cache: Arc::new(RwLock::new(HashMap::new())),
            emoji_font_cache: Arc::new(RwLock::new(None)),
            transition_frame: Arc::new(RwLock::new(None)),
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

    /// Get all layers sorted by priority (for future HTTP API)
    #[allow(dead_code)]
    pub async fn get_all_layers(&self) -> Vec<Layer> {
        let config = self.config.read().await;
        let mut layers: Vec<Layer> = config.layers.values().cloned().collect();
        layers.sort_by_key(|layer| layer.priority);
        layers
    }

    /// Get only visible layers (for future HTTP API)
    #[allow(dead_code)]
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

    pub async fn set_transition_frame(&self, frame: Option<RgbaImage>) {
        *self.transition_frame.write().await = frame;
        *self.composite_dirty.write().await = true;
    }

    pub async fn has_emergency_layers(&self) -> bool {
        let config = self.config.read().await;
        config.layers.values().any(|layer| {
            layer.visible && layer.layer_type == LayerType::Emergency
        })
    }

    pub async fn render_emergency_layers_only(&self) -> Result<RgbaImage, String> {
        let config = self.config.read().await;
        let (width, height) = config.output_resolution;

        let mut overlay = RgbaImage::new(width, height);
        for pixel in overlay.pixels_mut() {
            *pixel = Rgba([0, 0, 0, 0]);
        }

        let emergency_layers: Vec<Layer> = config.layers
            .values()
            .filter(|layer| layer.visible && layer.layer_type == LayerType::Emergency)
            .cloned()
            .collect();

        for layer in emergency_layers {
            if let Err(e) = self.render_layer_onto_composite(&layer, &mut overlay).await {
                eprintln!("Warning: Failed to render emergency layer '{}': {}", layer.id, e);
            }
        }

        Ok(overlay)
    }

    pub async fn render_composite(&self) -> Result<RgbaImage, String> {
        // Update animations first
        self.update_all_animations().await;
        
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
        // Check if this is the slideshow layer and we have a transition frame
        if layer.layer_type == LayerType::Slideshow {
            let transition_frame = self.transition_frame.read().await;
            if let Some(ref frame) = *transition_frame {
                self.blend_layer_onto_composite(frame, layer, composite);
                return Ok(());
            }
        }

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
            LayerContent::DataRow { text, background_color, text_color, font_size, alignment } => {
                self.render_data_row_layer(layer, text, *background_color, *text_color, *font_size, alignment, composite).await
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
        let img = image::open(image_path)
            .map_err(|e| format!("Failed to load image '{}': {}", image_path, e))?
            .to_rgba8();

        // Calculate scaling factor to preserve aspect ratio (letterboxing)
        let original_width = img.width() as f32;
        let original_height = img.height() as f32;
        let target_width = position.width as f32;
        let target_height = position.height as f32;

        let scale_x = target_width / original_width;
        let scale_y = target_height / original_height;
        let scale = scale_x.min(scale_y);

        let scaled_width = (original_width * scale) as u32;
        let scaled_height = (original_height * scale) as u32;

        // Scale while preserving aspect ratio
        let scaled_img = image::imageops::resize(
            &img,
            scaled_width,
            scaled_height,
            image::imageops::FilterType::Lanczos3,
        );

        // Create transparent background at target dimensions
        let mut result = RgbaImage::new(position.width, position.height);
        for pixel in result.pixels_mut() {
            *pixel = Rgba([0, 0, 0, 0]);
        }

        // Center the scaled image
        let x_offset = (position.width - scaled_width) / 2;
        let y_offset = (position.height - scaled_height) / 2;

        for y in 0..scaled_height {
            for x in 0..scaled_width {
                let pixel = *scaled_img.get_pixel(x, y);
                result.put_pixel(x + x_offset, y + y_offset, pixel);
            }
        }

        Ok(result)
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

    /// Clear image cache (for future HTTP API)
    #[allow(dead_code)]
    pub async fn clear_cache(&self) {
        self.image_cache.write().await.clear();
        *self.last_composite.write().await = None;
        *self.composite_dirty.write().await = true;
    }

    /// Get current layer configuration (for future HTTP API)
    #[allow(dead_code)]
    pub async fn get_config(&self) -> LayerConfig {
        self.config.read().await.clone()
    }

    /// Get the last rendered composite image (for preview streaming)
    pub async fn get_last_composite(&self) -> Option<RgbaImage> {
        self.last_composite.read().await.clone()
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

    /// Get cache statistics (for future HTTP API)
    #[allow(dead_code)]
    pub async fn get_cache_stats(&self) -> (usize, usize) {
        let cache = self.image_cache.read().await;
        let cached_items = cache.len();
        let memory_usage = cache.values()
            .map(|img| (img.width() * img.height() * 4) as usize)
            .sum();
        (cached_items, memory_usage)
    }

    async fn get_or_load_font(&self) -> Result<Font, String> {
        let font_key = "default".to_string();

        // Check cache first
        {
            let cache = self.font_cache.read().await;
            if let Some(font) = cache.get(&font_key) {
                return Ok(font.clone());
            }
        }

        // Try to load a system font or embedded fallback
        let font_data = self.load_font_data()?;
        let font = Font::from_bytes(font_data, FontSettings::default())
            .map_err(|e| format!("Failed to parse font: {:?}", e))?;

        // Cache the font
        let mut cache = self.font_cache.write().await;
        cache.insert(font_key, font.clone());

        Ok(font)
    }

    fn load_font_data(&self) -> Result<Vec<u8>, String> {
        // Try common system font paths
        let font_paths = [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",           // Debian/Ubuntu
            "/usr/share/fonts/dejavu-sans-fonts/DejaVuSans.ttf",         // Fedora/RHEL
            "/System/Library/Fonts/Helvetica.ttc",                        // macOS
            "C:\\Windows\\Fonts\\arial.ttf",                              // Windows
        ];

        for path in &font_paths {
            if let Ok(data) = std::fs::read(path) {
                println!("Loaded font from: {}", path);
                return Ok(data);
            }
        }

        // Fallback to embedded minimal font data (Noto Sans Regular subset)
        // This is a minimal fallback - in production, bundle a full font file
        Err("No system fonts found. Please install DejaVu Sans or another TrueType font.".to_string())
    }

    async fn get_or_load_emoji_font(&self) -> Option<Font> {
        // Check cache first
        {
            let cache = self.emoji_font_cache.read().await;
            if let Some(ref font) = *cache {
                return Some(font.clone());
            }
        }

        // Try to load emoji font
        if let Ok(font_data) = self.load_emoji_font_data() {
            if let Ok(font) = Font::from_bytes(font_data, FontSettings::default()) {
                println!("Loaded emoji font successfully");
                let mut cache = self.emoji_font_cache.write().await;
                *cache = Some(font.clone());
                return Some(font);
            }
        }

        None
    }

    fn load_emoji_font_data(&self) -> Result<Vec<u8>, String> {
        let emoji_font_paths = [
            "/usr/share/fonts/truetype/noto/NotoEmoji-Regular.ttf",
            "/usr/share/fonts/noto-emoji/NotoEmoji-Regular.ttf",
            "/usr/share/fonts/google-noto-emoji/NotoEmoji-Regular.ttf",
            "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
            "/usr/share/fonts/noto/NotoEmoji-Regular.ttf",
            "/usr/share/fonts/opentype/noto/NotoEmoji-Regular.ttf",
        ];

        for path in &emoji_font_paths {
            if let Ok(data) = std::fs::read(path) {
                println!("Loaded emoji font from: {}", path);
                return Ok(data);
            }
        }

        Err("No emoji font found".to_string())
    }

    fn is_emoji_char(ch: char) -> bool {
        let code = ch as u32;
        // Common emoji ranges
        (0x1F300..=0x1F9FF).contains(&code) ||  // Miscellaneous Symbols and Pictographs, Emoticons, etc.
        (0x2600..=0x26FF).contains(&code) ||    // Miscellaneous Symbols
        (0x2700..=0x27BF).contains(&code) ||    // Dingbats
        (0x1F600..=0x1F64F).contains(&code) ||  // Emoticons
        (0x1F680..=0x1F6FF).contains(&code) ||  // Transport and Map Symbols
        (0x1F1E0..=0x1F1FF).contains(&code)     // Flags
    }

    async fn update_all_animations(&self) {
        let mut config = self.config.write().await;
        let mut any_animation_active = false;
        
        for layer in config.layers.values_mut() {
            if layer.update_animation() {
                any_animation_active = true;
            }
        }
        
        // Mark composite as dirty if any animation is active
        if any_animation_active {
            *self.composite_dirty.write().await = true;
        }
    }
    
    async fn render_data_row_layer(&self, layer: &Layer, text: &str, bg_color: (u8, u8, u8, u8), text_color: (u8, u8, u8, u8), font_size: u32, alignment: &str, composite: &mut RgbaImage) -> Result<(), String> {
        // First render background
        for y in layer.position.y..(layer.position.y + layer.position.height) {
            for x in layer.position.x..(layer.position.x + layer.position.width) {
                if x < composite.width() && y < composite.height() {
                    let final_alpha = (bg_color.3 as f32 * layer.opacity) as u8;
                    let pixel_color = Rgba([bg_color.0, bg_color.1, bg_color.2, final_alpha]);

                    if let Some(existing_pixel) = composite.get_pixel_mut_checked(x, y) {
                        *existing_pixel = self.blend_pixels(*existing_pixel, pixel_color);
                    }
                }
            }
        }

        // Load fonts
        let font = match self.get_or_load_font().await {
            Ok(f) => f,
            Err(e) => {
                eprintln!("Warning: Could not load font: {}. Text will not be rendered.", e);
                return Ok(());
            }
        };
        let emoji_font = self.get_or_load_emoji_font().await;

        let scale = font_size as f32;
        let line_spacing = (font_size as f32 * 0.3) as u32;

        // Split text into lines
        let lines: Vec<&str> = text.split('\n').collect();

        // Helper to get metrics for a character (with emoji fallback)
        let get_char_metrics = |ch: char, font: &Font, emoji_font: &Option<Font>| -> (fontdue::Metrics, Vec<u8>) {
            // Try emoji font first for emoji characters
            if Self::is_emoji_char(ch) {
                if let Some(ref ef) = emoji_font {
                    let (metrics, bitmap) = ef.rasterize(ch, scale);
                    if !bitmap.is_empty() && metrics.width > 0 {
                        return (metrics, bitmap);
                    }
                }
            }
            // Fall back to regular font
            font.rasterize(ch, scale)
        };

        // Measure each line
        struct LineMeasurement {
            width: f32,
            height: f32,
        }
        let mut line_measurements: Vec<LineMeasurement> = Vec::new();
        let mut total_height = 0.0f32;

        for line in &lines {
            let mut line_width = 0.0f32;
            let mut line_height = 0.0f32;
            for ch in line.chars() {
                let (metrics, _) = get_char_metrics(ch, &font, &emoji_font);
                line_width += metrics.advance_width;
                line_height = line_height.max(metrics.height as f32);
            }
            if line_height < font_size as f32 {
                line_height = font_size as f32;
            }
            total_height += line_height;
            line_measurements.push(LineMeasurement { width: line_width, height: line_height });
        }

        // Add line spacing between lines
        if lines.len() > 1 {
            total_height += (lines.len() as u32 - 1) as f32 * line_spacing as f32;
        }

        // Calculate starting Y to vertically center the text block
        let block_start_y = layer.position.y + ((layer.position.height as f32 - total_height) / 2.0).max(0.0) as u32;
        let mut current_y = block_start_y;

        // Render each line
        for (line_idx, line) in lines.iter().enumerate() {
            let measurement = &line_measurements[line_idx];

            // Calculate starting X based on alignment
            let start_x = match alignment {
                "center" => layer.position.x + ((layer.position.width as f32 - measurement.width) / 2.0).max(0.0) as u32,
                "right" => layer.position.x + (layer.position.width as f32 - measurement.width).max(0.0) as u32,
                _ => layer.position.x + 10,
            };

            // Render each character in the line
            let mut current_x = start_x as f32;

            for ch in line.chars() {
                let (metrics, bitmap) = get_char_metrics(ch, &font, &emoji_font);

                if !bitmap.is_empty() {
                    let glyph_x = (current_x + metrics.xmin as f32) as u32;
                    let glyph_y = current_y + font_size - metrics.ymin as u32 - metrics.height as u32;

                    for (i, &coverage) in bitmap.iter().enumerate() {
                        if coverage > 0 {
                            let px = glyph_x + (i % metrics.width) as u32;
                            let py = glyph_y + (i / metrics.width) as u32;

                            if px >= layer.position.x && px < layer.position.x + layer.position.width &&
                               py >= layer.position.y && py < layer.position.y + layer.position.height &&
                               px < composite.width() && py < composite.height() {

                                let alpha = ((coverage as f32 / 255.0) * (text_color.3 as f32 / 255.0) * layer.opacity * 255.0) as u8;
                                let text_pixel = Rgba([text_color.0, text_color.1, text_color.2, alpha]);

                                if let Some(existing_pixel) = composite.get_pixel_mut_checked(px, py) {
                                    *existing_pixel = self.blend_pixels(*existing_pixel, text_pixel);
                                }
                            }
                        }
                    }
                }

                current_x += metrics.advance_width;
            }

            // Move to next line
            current_y += measurement.height as u32 + line_spacing;
        }

        Ok(())
    }
    
    // Animation control methods (for future HTTP API)
    /// Start animation on a layer by type (for future HTTP API)
    #[allow(dead_code)]
    pub async fn start_layer_animation(&self, layer_id: &str, animation_type: AnimationType, duration_ms: u64, distance: Option<f32>) -> Result<(), String> {
        let mut config = self.config.write().await;

        if let Some(layer) = config.layers.get_mut(layer_id) {
            match animation_type {
                AnimationType::SlideUp => layer.start_slide_up(distance.unwrap_or(100.0), duration_ms),
                AnimationType::SlideDown => layer.start_slide_down(distance.unwrap_or(100.0), duration_ms),
                AnimationType::SlideLeft => layer.start_slide_left(distance.unwrap_or(100.0), duration_ms),
                AnimationType::SlideRight => layer.start_slide_right(distance.unwrap_or(100.0), duration_ms),
                AnimationType::FadeIn => layer.start_fade_in(duration_ms),
                AnimationType::FadeOut => layer.start_fade_out(duration_ms),
                _ => return Err("Unsupported animation type".to_string()),
            }
            *self.composite_dirty.write().await = true;
            Ok(())
        } else {
            Err(format!("Layer '{}' not found", layer_id))
        }
    }

    /// Move layer to position with optional animation (for future HTTP API)
    #[allow(dead_code)]
    pub async fn move_layer_to(&self, layer_id: &str, x: u32, y: u32, animate: bool, duration_ms: u64) -> Result<(), String> {
        let mut config = self.config.write().await;

        if let Some(layer) = config.layers.get_mut(layer_id) {
            if animate {
                layer.start_move_to(x, y, duration_ms);
            } else {
                layer.position.x = x;
                layer.position.y = y;
            }
            *self.composite_dirty.write().await = true;
            Ok(())
        } else {
            Err(format!("Layer '{}' not found", layer_id))
        }
    }

    /// Add a data row layer (for future data row feature)
    #[allow(dead_code)]
    pub async fn add_data_row_layer(&self, id: String, text: String, y_position: u32, height: u32) -> Result<(), String> {
        let layer = Layer::new(id.clone(), LayerType::DataRow)
            .with_position(0, y_position, 1920, height)
            .with_data_row(
                text,
                (0, 0, 0, 200),      // Semi-transparent black background
                (255, 255, 255, 255), // White text
                24,                   // Font size
                "left".to_string()    // Alignment
            )
            .with_priority(15);

        self.add_layer(layer).await
    }
}