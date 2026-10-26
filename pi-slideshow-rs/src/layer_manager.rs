use image::{Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use crate::layer_animation::{AnimationState, AnimationType, AnimationValue};
use fontdue::{Font, FontSettings};
use crate::layer_data::{self, TableSpec};
use crate::emoji::{self, Piece};
use crate::mqtt_client::parse_rgba_string;

/// Gap between text and the edge of its layer when aligned to that edge
const TEXT_INSET: f32 = 10.0;

fn text_width(font: &Font, text: &str, size: f32) -> f32 {
    emoji::pieces(text).into_iter().map(|piece| piece_advance(font, piece, size)).sum()
}

fn piece_advance(font: &Font, piece: Piece, size: f32) -> f32 {
    match piece {
        Piece::Char(ch) => font.metrics(ch, size).advance_width,
        Piece::Emoji(ch) => emoji::advance(ch, size),
    }
}

/// The text, shortened with an ellipsis if it is wider than max_width
fn fit_text(font: &Font, text: &str, size: f32, max_width: f32) -> String {
    if text_width(font, text, size) <= max_width {
        return text.to_string();
    }
    let ellipsis = '…';
    let budget = max_width - font.metrics(ellipsis, size).advance_width;
    let mut width = 0.0;
    let mut out = String::new();
    for piece in emoji::pieces(text) {
        width += piece_advance(font, piece, size);
        if width > budget {
            break;
        }
        match piece {
            Piece::Char(ch) => out.push(ch),
            // Keep it an emoji when the shortened text is split again
            Piece::Emoji(ch) => { out.push(ch); out.push('\u{FE0F}'); }
        }
    }
    format!("{}{}", out.trim_end(), ellipsis)
}

/// Fonts the Layer Control editor offers: (name, regular file, bold file).
/// These ship with Raspberry Pi OS (fonts-dejavu-core, fonts-liberation2).
const FONT_FILES: &[(&str, &str, &str)] = &[
    ("DejaVu Sans", "dejavu/DejaVuSans.ttf", "dejavu/DejaVuSans-Bold.ttf"),
    ("DejaVu Serif", "dejavu/DejaVuSerif.ttf", "dejavu/DejaVuSerif-Bold.ttf"),
    ("DejaVu Sans Mono", "dejavu/DejaVuSansMono.ttf", "dejavu/DejaVuSansMono-Bold.ttf"),
    ("Liberation Sans", "liberation/LiberationSans-Regular.ttf", "liberation/LiberationSans-Bold.ttf"),
    ("Liberation Serif", "liberation/LiberationSerif-Regular.ttf", "liberation/LiberationSerif-Bold.ttf"),
    ("Liberation Sans Narrow", "liberation/LiberationSansNarrow-Regular.ttf", "liberation/LiberationSansNarrow-Bold.ttf"),
];
const FONT_DIR: &str = "/usr/share/fonts/truetype";

/// Font file for a family name and weight; unknown names (e.g. the old
/// "Arial" default) use DejaVu Sans, which is what the TV always drew
fn font_file(family: &str, bold: bool) -> String {
    let (_, regular, bold_file) = FONT_FILES.iter()
        .find(|(name, _, _)| name.eq_ignore_ascii_case(family))
        .unwrap_or(&FONT_FILES[0]);
    format!("{}/{}", FONT_DIR, if bold { bold_file } else { regular })
}

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
        #[serde(default)]
        vertical_alignment: String,  // top, middle (default), bottom
        #[serde(default)]
        font_family: String,  // one of FONT_FILES' names; anything else = DejaVu Sans
        #[serde(default)]
        bold: bool,
    },
    Table(TableSpec),       // Rows from a data set (e.g. the court calendar)
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
            vertical_alignment: String::new(),
            font_family: String::new(),
            bold: false,
        };
        self
    }

    pub fn with_font(mut self, family: &str, is_bold: bool) -> Self {
        if let LayerContent::DataRow { ref mut font_family, ref mut bold, .. } = self.content {
            *font_family = family.to_string();
            *bold = is_bold;
        }
        self
    }

    pub fn with_vertical_alignment(mut self, value: &str) -> Self {
        if let LayerContent::DataRow { ref mut vertical_alignment, .. } = self.content {
            *vertical_alignment = value.to_string();
        }
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
    transition_frame: Arc<RwLock<Option<RgbaImage>>>,
    data: Arc<RwLock<LayerData>>,
    // Clock minute + table pages shown in the last composite; a change means redraw
    last_dynamic_key: Arc<RwLock<String>>,
    // Elements of the scene clip on screen: drawn above the slideshow and below
    // every overlay, whatever their priorities
    base_layers: Arc<RwLock<Vec<Layer>>>,
}

/// Values for {tokens} (weather) and data set rows (court calendar)
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct LayerData {
    pub values: HashMap<String, String>,
    pub datasets: HashMap<String, Vec<serde_json::Value>>,
    /// When the manager last confirmed a live data set (absent for uploads)
    #[serde(default)]
    pub checked_at: HashMap<String, chrono::DateTime<chrono::Utc>>,
}

/// Space between a table cell's edge and its text
const CELL_PADDING: f32 = 14.0;
/// Calendar rows: the hearing on now, and status colours
const CURRENT_ROW: (u8, u8, u8, u8) = (201, 162, 39, 70);
const CURRENT_MARK: (u8, u8, u8, u8) = (201, 162, 39, 255);
const STATUS_CONTINUED: (u8, u8, u8, u8) = (246, 173, 85, 255);
const STATUS_CANCELLED: (u8, u8, u8, u8) = (252, 129, 129, 255);
const STATUS_HEARD: (u8, u8, u8, u8) = (154, 230, 180, 200);

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
            transition_frame: Arc::new(RwLock::new(None)),
            data: Arc::new(RwLock::new(LayerData::default())),
            last_dynamic_key: Arc::new(RwLock::new(String::new())),
            base_layers: Arc::new(RwLock::new(Vec::new())),
        }
    }

    /// The scene clip now on screen (empty for an image clip)
    pub async fn set_base_layers(&self, layers: Vec<Layer>) {
        *self.base_layers.write().await = layers;
        *self.composite_dirty.write().await = true;
    }

    /// A scene drawn on its own (black background), used as a transition frame
    pub async fn render_scene_snapshot(&self, layers: &[Layer]) -> RgbaImage {
        let (width, height) = self.config.read().await.output_resolution;
        let mut frame = RgbaImage::from_pixel(width, height, Rgba([0, 0, 0, 255]));
        let mut layers: Vec<&Layer> = layers.iter().filter(|l| l.visible).collect();
        layers.sort_by_key(|l| l.priority);
        for layer in layers {
            if let Err(e) = self.render_layer_onto_composite(layer, &mut frame).await {
                eprintln!("Warning: Failed to render scene element '{}': {}", layer.id, e);
            }
        }
        frame
    }

    pub async fn set_data(&self, data: LayerData) {
        *self.data.write().await = data;
        *self.composite_dirty.write().await = true;
    }

    /// What the live layers would show right now: the minute (if any text uses
    /// the clock) and each table's page
    async fn dynamic_key(&self) -> String {
        let config = self.config.read().await;
        let base = self.base_layers.read().await;
        let data = self.data.read().await;
        let now = chrono::Local::now().fixed_offset();
        let mut key = String::new();
        for layer in config.layers.values().chain(base.iter()).filter(|l| l.visible) {
            match &layer.content {
                LayerContent::DataRow { text, .. } if layer_data::uses_clock(text) => {
                    key.push_str(&now.format("%Y%m%d%H%M|").to_string());
                }
                LayerContent::Table(spec) => {
                    let rows = data.datasets.get(&spec.dataset).map(Vec::as_slice).unwrap_or(&[]);
                    let count = layer_data::table_rows(spec, rows, now.naive_local()).len();
                    let (_, _, page) = layer_data::paging(spec, layer.position.height, count, now.timestamp() as u64);
                    // The minute too: the current hearing, heard rows dropping off and staleness move with it
                    key.push_str(&format!("{}:{}:{}|", layer.id, now.format("%Y%m%d%H%M"), page));
                }
                _ => {}
            }
        }
        key
    }

    pub async fn add_layer(&self, mut layer: Layer) -> Result<(), String> {
        // Auto-position emergency layers to stack without overlap
        if layer.layer_type == LayerType::Emergency {
            let next_y = self.get_next_emergency_y().await;
            layer.position.y = next_y;
            println!("📍 Auto-positioned emergency layer {} at Y={}", layer.id, next_y);
        }

        let mut config = self.config.write().await;

        // Same rule as the management server: the limit covers the TV's own layers,
        // not the slideshow, and alerts must always be able to appear
        let counts_toward_limit = |l: &Layer| !matches!(l.layer_type, LayerType::Slideshow | LayerType::Emergency);
        if counts_toward_limit(&layer)
            && config.layers.values().filter(|l| counts_toward_limit(l)).count() >= config.max_layers as usize
        {
            return Err(format!("Maximum number of layers ({}) reached", config.max_layers));
        }

        // Validate layer position is within bounds (skip for emergency layers that may extend)
        let (width, height) = config.output_resolution;
        if layer.layer_type != LayerType::Emergency {
            if layer.position.x + layer.position.width > width ||
               layer.position.y + layer.position.height > height {
                return Err("Layer position exceeds output resolution bounds".to_string());
            }
        }

        config.layers.insert(layer.id.clone(), layer);
        *self.composite_dirty.write().await = true;
        Ok(())
    }

    pub async fn remove_layer(&self, id: &str) -> Result<(), String> {
        let was_emergency = {
            let mut config = self.config.write().await;

            // Don't allow removal of the slideshow layer
            if id == "slideshow" {
                return Err("Cannot remove the slideshow layer".to_string());
            }

            if let Some(removed_layer) = config.layers.remove(id) {
                *self.composite_dirty.write().await = true;
                removed_layer.layer_type == LayerType::Emergency
            } else {
                return Err(format!("Layer '{}' not found", id));
            }
        };

        // Restack remaining emergency layers if we removed one
        if was_emergency {
            self.restack_emergency_layers().await;
        }

        Ok(())
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

    /// Anything drawn on top of the slideshow (logo, Layer Control layers, alerts)
    pub async fn has_overlay_layers(&self) -> bool {
        let config = self.config.read().await;
        config.layers.values().any(|layer| {
            layer.visible && layer.layer_type != LayerType::Slideshow
        })
    }

    /// Get IDs of all emergency layers
    pub async fn get_emergency_layer_ids(&self) -> std::collections::HashSet<String> {
        let config = self.config.read().await;
        config.layers
            .values()
            .filter(|layer| layer.layer_type == LayerType::Emergency)
            .map(|layer| layer.id.clone())
            .collect()
    }

    /// Calculate the next available Y position for emergency layers (auto-stacking)
    async fn get_next_emergency_y(&self) -> u32 {
        let config = self.config.read().await;
        config.layers
            .values()
            .filter(|l| l.visible && l.layer_type == LayerType::Emergency)
            .map(|l| l.position.y + l.position.height)
            .max()
            .unwrap_or(0)
    }

    /// Restack emergency layers to collapse gaps after removal
    pub async fn restack_emergency_layers(&self) {
        let mut config = self.config.write().await;

        // Collect mutable references to emergency layers sorted by Y position
        let mut emergency_ids: Vec<(String, u32)> = config.layers
            .iter()
            .filter(|(_, l)| l.visible && l.layer_type == LayerType::Emergency)
            .map(|(id, l)| (id.clone(), l.position.y))
            .collect();

        // Sort by current Y position to preserve relative order
        emergency_ids.sort_by_key(|(_, y)| *y);

        // Reposition sequentially from top
        let mut current_y: u32 = 0;
        for (id, _) in emergency_ids {
            if let Some(layer) = config.layers.get_mut(&id) {
                if layer.position.y != current_y {
                    layer.position.y = current_y;
                }
                current_y += layer.position.height;
            }
        }

        *self.composite_dirty.write().await = true;
    }

    /// Every visible layer except the slideshow, on a transparent canvas, so
    /// transitions can play underneath the logo, Layer Control layers and alerts
    pub async fn render_overlay_layers(&self) -> Result<RgbaImage, String> {
        let config = self.config.read().await;
        let (width, height) = config.output_resolution;

        let mut overlay = RgbaImage::new(width, height);
        for pixel in overlay.pixels_mut() {
            *pixel = Rgba([0, 0, 0, 0]);
        }

        let mut overlay_layers: Vec<Layer> = config.layers
            .values()
            .filter(|layer| layer.visible && layer.layer_type != LayerType::Slideshow)
            .cloned()
            .collect();
        overlay_layers.sort_by_key(|layer| layer.priority);

        for layer in overlay_layers {
            if let Err(e) = self.render_layer_onto_composite(&layer, &mut overlay).await {
                eprintln!("Warning: Failed to render overlay layer '{}': {}", layer.id, e);
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
        
        // Start from opaque black (the letterbox colour) so translucent layers over
        // the letterbox blend with black instead of drawing at full strength
        for pixel in composite.pixels_mut() {
            *pixel = Rgba([0, 0, 0, 255]);
        }

        // Bottom to top: slideshow, the scene clip's elements, then overlays (and
        // alerts) by priority
        let mut visible_layers: Vec<Layer> = config.layers
            .values()
            .filter(|layer| layer.visible)
            .cloned()
            .collect();
        visible_layers.sort_by_key(|layer| (layer.layer_type != LayerType::Slideshow, layer.priority));
        let mut base: Vec<Layer> = self.base_layers.read().await.iter().filter(|l| l.visible).cloned().collect();
        base.sort_by_key(|layer| layer.priority);
        let split = visible_layers.iter().position(|l| l.layer_type != LayerType::Slideshow).unwrap_or(visible_layers.len());
        visible_layers.splice(split..split, base);

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
            LayerContent::DataRow { text, background_color, text_color, font_size, alignment, vertical_alignment, font_family, bold } => {
                let font = self.get_or_load_font(font_family, *bold).await;
                let text = {
                    let data = self.data.read().await;
                    layer_data::expand_tokens(text, &chrono::Local::now().fixed_offset(), &data.values)
                };
                self.render_data_row_layer(layer, &text, *background_color, *text_color, *font_size, alignment, vertical_alignment, font, composite).await
            }
            LayerContent::Table(spec) => self.render_table_layer(layer, spec, composite).await,
            LayerContent::Empty => Ok(()),
        }
    }

    async fn render_image_layer(&self, layer: &Layer, image_path: &str, composite: &mut RgbaImage) -> Result<(), String> {
        // Cached per size, since the image is scaled to fit the layer
        let cache_key = format!("{}@{}x{}", image_path, layer.position.width, layer.position.height);
        let cached_image = {
            let cache = self.image_cache.read().await;
            cache.get(&cache_key).cloned()
        };

        let layer_image = match cached_image {
            Some(img) => img,
            None => {
                // Load and cache image
                let img = self.load_and_process_image(image_path, &layer.position).await?;
                let mut cache = self.image_cache.write().await;
                cache.insert(cache_key, img.clone());
                img
            }
        };

        // Apply layer to composite with opacity
        self.blend_layer_onto_composite(&layer_image, layer, composite);
        Ok(())
    }

    async fn render_table_layer(&self, layer: &Layer, spec: &TableSpec, composite: &mut RgbaImage) -> Result<(), String> {
        let font = self.get_or_load_font(&spec.font_family, false).await?;
        let bold = self.get_or_load_font(&spec.font_family, true).await.unwrap_or_else(|_| font.clone());
        let now = chrono::Local::now().fixed_offset();
        let data = self.data.read().await;
        let all_rows = data.datasets.get(&spec.dataset).map(Vec::as_slice).unwrap_or(&[]);
        let freshness = layer_data::freshness(spec, data.checked_at.get(&spec.dataset).copied(), chrono::Utc::now());
        let rows = if freshness == layer_data::Freshness::Unavailable {
            Vec::new()
        } else {
            layer_data::table_rows(spec, all_rows, now.naive_local())
        };
        let styles = layer_data::row_styles(spec, &rows, now.naive_local());

        let pos = &layer.position;
        let row_height = spec.row_height.max(20);
        let (per_page, pages, page) = layer_data::paging(spec, pos.height, rows.len(), now.timestamp() as u64);
        let text_color = parse_rgba_string(&spec.text_color);
        let opacity = layer.opacity;

        // Header
        self.fill_rect(pos.x, pos.y, pos.width, row_height, parse_rgba_string(&spec.header_background), opacity, composite);
        let header_color = parse_rgba_string(&spec.header_text_color);
        let mut x = pos.x;
        for column in &spec.columns {
            let label = fit_text(&bold, &column.label, spec.header_font_size as f32, column.width as f32 - 2.0 * CELL_PADDING);
            self.draw_text(&bold, &label, spec.header_font_size as f32, x as f32 + CELL_PADDING, pos.y, row_height, x + column.width, header_color, opacity, composite);
            x += column.width;
        }

        // Rows on the current page, striped; styled by hearing status
        let row_colors = [parse_rgba_string(&spec.row_background), parse_rgba_string(&spec.alt_row_background)];
        let dim = |c: (u8, u8, u8, u8)| (c.0, c.1, c.2, (c.3 as f32 * 0.55) as u8);
        for (i, (row, style)) in rows.iter().zip(&styles).skip(page * per_page).take(per_page).enumerate() {
            use layer_data::RowStyle;
            let y = pos.y + row_height * (i as u32 + 1);
            self.fill_rect(pos.x, y, pos.width, row_height, row_colors[i % 2], opacity, composite);
            if *style == RowStyle::Current {
                self.fill_rect(pos.x, y, pos.width, row_height, CURRENT_ROW, opacity, composite);
                self.fill_rect(pos.x, y, 8, row_height, CURRENT_MARK, opacity, composite);
            }
            let row_color = match style {
                RowStyle::Heard | RowStyle::Cancelled => dim(text_color),
                _ => text_color,
            };
            let mut x = pos.x;
            for column in &spec.columns {
                let is_status = column.field == "status";
                let color = match (style, is_status) {
                    (RowStyle::Continued, true) => STATUS_CONTINUED,
                    (RowStyle::Cancelled, true) => STATUS_CANCELLED,
                    (RowStyle::Heard, true) => STATUS_HEARD,
                    _ => row_color,
                };
                let value = layer_data::cell_text(row, &column.field);
                let value = fit_text(&font, &value, spec.font_size as f32, column.width as f32 - 2.0 * CELL_PADDING);
                self.draw_text(&font, &value, spec.font_size as f32, x as f32 + CELL_PADDING, y, row_height, x + column.width, color, opacity, composite);
                // Cancelled: strike through everything but the status itself
                if *style == RowStyle::Cancelled && !is_status && !value.is_empty() {
                    let width = text_width(&font, &value, spec.font_size as f32).ceil() as u32;
                    self.fill_rect(x + CELL_PADDING as u32, y + row_height / 2, width.min(column.width), 2, row_color, opacity, composite);
                }
                x += column.width;
            }
        }

        let size = spec.font_size as f32;
        let small = size * 0.75;
        if let layer_data::Freshness::Stale(checked) = freshness {
            // Bottom left, in the page indicator's strip
            let label = format!("Last updated {} · times may have changed", checked.with_timezone(&chrono::Local).format("%-I:%M %p"));
            self.draw_text(&font, &label, small, pos.x as f32 + CELL_PADDING, pos.y + row_height * (per_page as u32 + 1), row_height / 2, pos.x + pos.width, STATUS_CONTINUED, opacity, composite);
        }
        if freshness == layer_data::Freshness::Unavailable {
            let message = fit_text(&font, &spec.unavailable_text, size, pos.width as f32 - 2.0 * CELL_PADDING);
            let left = pos.x as f32 + (pos.width as f32 - text_width(&font, &message, size)) / 2.0;
            self.draw_text(&font, &message, size, left, pos.y + row_height, row_height * 2, pos.x + pos.width, text_color, opacity, composite);
        } else if rows.is_empty() {
            let message = fit_text(&font, &spec.empty_text, size, pos.width as f32 - 2.0 * CELL_PADDING);
            let left = pos.x as f32 + (pos.width as f32 - text_width(&font, &message, size)) / 2.0;
            self.draw_text(&font, &message, size, left, pos.y + row_height, row_height * 2, pos.x + pos.width, text_color, opacity, composite);
        } else if pages > 1 {
            let label = format!("Page {} of {}", page + 1, pages);
            let left = (pos.x + pos.width) as f32 - CELL_PADDING - text_width(&font, &label, small);
            self.draw_text(&font, &label, small, left, pos.y + row_height * (per_page as u32 + 1), row_height / 2, pos.x + pos.width, text_color, opacity, composite);
        }
        Ok(())
    }

    fn fill_rect(&self, x: u32, y: u32, width: u32, height: u32, color: (u8, u8, u8, u8), opacity: f32, composite: &mut RgbaImage) {
        let pixel = Rgba([color.0, color.1, color.2, (color.3 as f32 * opacity) as u8]);
        for py in y..(y + height).min(composite.height()) {
            for px in x..(x + width).min(composite.width()) {
                let existing = *composite.get_pixel(px, py);
                composite.put_pixel(px, py, self.blend_pixels(existing, pixel));
            }
        }
    }

    /// One line of text vertically centred in the band [top, top + height),
    /// clipped on the right at clip_right
    #[allow(clippy::too_many_arguments)]
    fn draw_text(&self, font: &Font, text: &str, size: f32, left: f32, top: u32, height: u32, clip_right: u32, color: (u8, u8, u8, u8), opacity: f32, composite: &mut RgbaImage) {
        let (ascent, descent) = font.horizontal_line_metrics(size)
            .map(|m| (m.ascent, m.descent))
            .unwrap_or((size * 0.8, -size * 0.2));
        let baseline = top as f32 + (height as f32 - (ascent - descent)) / 2.0 + ascent;
        let clip_right = clip_right.min(composite.width()) as i32;
        let bottom = (top + height).min(composite.height()) as i32;

        let mut pen = left;
        for piece in emoji::pieces(text) {
            let ch = match piece {
                Piece::Char(ch) => ch,
                Piece::Emoji(ch) => {
                    if let Some(glyph) = emoji::glyph(ch, size) {
                        emoji::draw(&glyph, pen, baseline, opacity * color.3 as f32 / 255.0, (0, top as i32, clip_right, bottom),
                            composite, |a, b| self.blend_pixels(a, b));
                    }
                    pen += emoji::advance(ch, size);
                    continue;
                }
            };
            let (metrics, bitmap) = font.rasterize(ch, size);
            let glyph_x = (pen + metrics.xmin as f32).round() as i32;
            let glyph_y = (baseline - metrics.height as f32 - metrics.ymin as f32).round() as i32;
            for (i, &coverage) in bitmap.iter().enumerate() {
                if coverage == 0 {
                    continue;
                }
                let px = glyph_x + (i % metrics.width) as i32;
                let py = glyph_y + (i / metrics.width) as i32;
                if px < 0 || py < top as i32 || px >= clip_right || py >= bottom {
                    continue;
                }
                let alpha = (coverage as f32 / 255.0) * (color.3 as f32 / 255.0) * opacity;
                let existing = *composite.get_pixel(px as u32, py as u32);
                composite.put_pixel(px as u32, py as u32, self.blend_pixels(existing, Rgba([color.0, color.1, color.2, (alpha * 255.0) as u8])));
            }
            pen += metrics.advance_width;
        }
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
        // Detect the format from the file contents: layer images are cached
        // without their original extension
        let img = image::io::Reader::open(image_path)
            .and_then(|reader| reader.with_guessed_format())
            .map_err(|e| format!("Failed to open image '{}': {}", image_path, e))?
            .decode()
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

        // The TV config only owns the slideshow and static overlays; keep alert and
        // Layer Control layers, and the image currently on the slideshow layer
        let mut config = config;
        {
            let current = self.config.read().await;
            for (id, layer) in &current.layers {
                let externally_managed = matches!(layer.layer_type, LayerType::Emergency | LayerType::DataRow);
                if externally_managed && !config.layers.contains_key(id) {
                    config.layers.insert(id.clone(), layer.clone());
                }
            }
            if let (Some(new_slideshow), Some(old_slideshow)) =
                (config.layers.get_mut("slideshow"), current.layers.get("slideshow"))
            {
                if matches!(new_slideshow.content, LayerContent::Empty) {
                    new_slideshow.content = old_slideshow.content.clone();
                }
            }
        }

        *self.config.write().await = config;
        *self.composite_dirty.write().await = true;
        Ok(())
    }

    /// Get cache statistics (for future HTTP API)
    #[allow(dead_code)]
    /// True when layers changed or are animating since the last composite
    pub async fn needs_redraw(&self) -> bool {
        // Clock ticked over or a table turned its page
        let key = self.dynamic_key().await;
        if *self.last_dynamic_key.read().await != key {
            *self.last_dynamic_key.write().await = key;
            *self.composite_dirty.write().await = true;
        }
        if *self.composite_dirty.read().await {
            return true;
        }
        self.config.read().await.layers.values().any(|layer| layer.animation_state.is_some())
    }

    pub async fn get_cache_stats(&self) -> (usize, usize) {
        let cache = self.image_cache.read().await;
        let cached_items = cache.len();
        let memory_usage = cache.values()
            .map(|img| (img.width() * img.height() * 4) as usize)
            .sum();
        (cached_items, memory_usage)
    }

    async fn get_or_load_font(&self, family: &str, bold: bool) -> Result<Font, String> {
        let font_key = font_file(family, bold);

        // Check cache first
        {
            let cache = self.font_cache.read().await;
            if let Some(font) = cache.get(&font_key) {
                return Ok(font.clone());
            }
        }

        // The chosen font, else the system default
        let font_data = match std::fs::read(&font_key) {
            Ok(data) => data,
            Err(e) => {
                eprintln!("Font {} unavailable ({}), using the default font", font_key, e);
                self.load_font_data()?
            }
        };
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
    
    async fn render_data_row_layer(&self, layer: &Layer, text: &str, bg_color: (u8, u8, u8, u8), text_color: (u8, u8, u8, u8), font_size: u32, alignment: &str, vertical_alignment: &str, font: Result<Font, String>, composite: &mut RgbaImage) -> Result<(), String> {
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

        // A layer with no text is just a colour block
        if text.trim().is_empty() {
            return Ok(());
        }

        let font = match font {
            Ok(f) => f,
            Err(e) => {
                eprintln!("Warning: Could not load font: {}. Text will not be rendered.", e);
                return Ok(());
            }
        };
        let scale = font_size as f32;
        let line_spacing = (font_size as f32 * 0.3) as u32;

        // Split text into lines
        let lines: Vec<&str> = text.split('\n').collect();

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
            for piece in emoji::pieces(line) {
                line_width += piece_advance(&font, piece, scale);
                if let Piece::Char(ch) = piece {
                    line_height = line_height.max(font.metrics(ch, scale).height as f32);
                }
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

        // Place the text block: top / bottom keep the same 10px inset as left / right
        let free_height = (layer.position.height as f32 - total_height).max(0.0);
        let block_offset = match vertical_alignment {
            "top" => TEXT_INSET.min(free_height),
            "bottom" => (free_height - TEXT_INSET).max(0.0),
            _ => free_height / 2.0,
        };
        let block_start_y = layer.position.y + block_offset as u32;
        let mut current_y = block_start_y;

        // Render each line
        for (line_idx, line) in lines.iter().enumerate() {
            let measurement = &line_measurements[line_idx];

            // Calculate starting X based on alignment
            let start_x = match alignment {
                "center" => layer.position.x + ((layer.position.width as f32 - measurement.width) / 2.0).max(0.0) as u32,
                "right" => layer.position.x + (layer.position.width as f32 - measurement.width - TEXT_INSET).max(0.0) as u32,
                _ => layer.position.x + TEXT_INSET as u32,
            };

            // Render each character in the line
            let mut current_x = start_x as f32;

            for piece in emoji::pieces(line) {
                let ch = match piece {
                    Piece::Char(ch) => ch,
                    Piece::Emoji(ch) => {
                        if let Some(glyph) = emoji::glyph(ch, scale) {
                            let pos = &layer.position;
                            let clip = (pos.x as i32, pos.y as i32, (pos.x + pos.width) as i32, (pos.y + pos.height) as i32);
                            emoji::draw(&glyph, current_x, (current_y + font_size) as f32, layer.opacity * text_color.3 as f32 / 255.0,
                                clip, composite, |a, b| self.blend_pixels(a, b));
                        }
                        current_x += emoji::advance(ch, scale);
                        continue;
                    }
                };
                let (metrics, bitmap) = font.rasterize(ch, scale);

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
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn font_file_picks_family_and_weight() {
        assert_eq!(font_file("Liberation Serif", true), "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf");
        assert_eq!(font_file("liberation sans narrow", false), "/usr/share/fonts/truetype/liberation/LiberationSansNarrow-Regular.ttf");
    }

    #[test]
    fn unknown_font_family_keeps_the_default() {
        assert_eq!(font_file("Arial", false), "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf");
        assert_eq!(font_file("", true), "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf");
    }
}
