use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc, RwLock};
use crate::mqtt_client::{AlertData, ImageInfo, MqttClient, SlideshowCommand, SlideshowConfig, TvStatus, parse_rgba_string};
use std::collections::{HashMap, HashSet};
use crate::couchdb_client::CouchDbClient;
use crate::layer_manager::{LayerManager, LayerConfig, Layer, LayerContent, LayerData, LayerType};
use crate::layer_data::TableSpec;

#[derive(Debug, Clone)]
pub enum SlideshowState {
    Playing,
    Paused,
    Stopped,
}

#[derive(Debug, Clone)]
pub struct ControllerConfig {
    pub image_dir: PathBuf,
    pub display_duration: Duration,
    pub transition_duration: Duration,
    pub couchdb_url: String,
    pub couchdb_username: Option<String>,
    pub couchdb_password: Option<String>,
    pub couchdb_database: String,
    pub couchdb_images_database: String,
    pub couchdb_layers_database: String,
    pub tv_id: String,
    pub orientation: String,
    pub transition_effect: String,
}

#[derive(Debug, Clone)]
pub struct RegistrationStatus {
    pub is_new: bool,
    pub tv_id: String,
    pub ip_address: String,
}

pub struct SlideshowController {
    config: Arc<RwLock<ControllerConfig>>,
    state: Arc<RwLock<SlideshowState>>,
    pub current_index: Arc<RwLock<usize>>,
    // Everything assigned to this TV; `images` is the subset whose schedule is active now
    all_images: Arc<RwLock<Vec<ImageInfo>>>,
    images: Arc<RwLock<Vec<ImageInfo>>>,
    command_receiver: broadcast::Receiver<SlideshowCommand>,
    status_sender: mpsc::Sender<TvStatus>,
    mqtt_client: Arc<RwLock<Option<MqttClient>>>,
    couchdb_client: Arc<RwLock<Option<CouchDbClient>>>,
    layer_manager: Arc<RwLock<LayerManager>>,
    registration_status: Arc<RwLock<Option<RegistrationStatus>>>,
    pub start_time: Instant,
    current_frame: Arc<RwLock<Option<image::RgbaImage>>>,
    // When next/previous/show_image last moved the slideshow, so auto-advance
    // gives the chosen image its full display time
    manual_change_at: Arc<RwLock<Option<Instant>>>,
    // Layer Control layers currently applied from the server (by layer_id)
    synced_layer_ids: Arc<RwLock<HashSet<String>>>,
    // Sequence playback: true while the TV plays a sequence (the old image
    // playlist and update_images are then ignored)
    sequence_active: Arc<RwLock<bool>>,
    // Elements of each scene in the sequence, ready to draw
    scene_layers: Arc<RwLock<HashMap<String, Vec<Layer>>>>,
    // Raw layer documents (overlays, scene elements) for image downloads and data sets
    overlay_values: Arc<RwLock<Vec<serde_json::Value>>>,
    scene_values: Arc<RwLock<Vec<serde_json::Value>>>,
    // Sequences are re-read on every sync: remember image file types, and which
    // scene content each snapshot was rendered from
    image_extensions: Arc<RwLock<HashMap<String, String>>>,
    snapshot_signatures: Arc<RwLock<HashMap<String, u64>>>,
}

impl Clone for SlideshowController {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            state: self.state.clone(),
            current_index: self.current_index.clone(),
            all_images: self.all_images.clone(),
            images: self.images.clone(),
            command_receiver: self.command_receiver.resubscribe(),
            status_sender: self.status_sender.clone(),
            mqtt_client: self.mqtt_client.clone(),
            couchdb_client: self.couchdb_client.clone(),
            layer_manager: self.layer_manager.clone(),
            registration_status: self.registration_status.clone(),
            start_time: self.start_time,
            current_frame: self.current_frame.clone(),
            manual_change_at: self.manual_change_at.clone(),
            synced_layer_ids: self.synced_layer_ids.clone(),
            sequence_active: self.sequence_active.clone(),
            scene_layers: self.scene_layers.clone(),
            overlay_values: self.overlay_values.clone(),
            scene_values: self.scene_values.clone(),
            image_extensions: self.image_extensions.clone(),
            snapshot_signatures: self.snapshot_signatures.clone(),
        }
    }
}

impl SlideshowController {
    pub fn new(
        config: ControllerConfig,
        command_receiver: broadcast::Receiver<SlideshowCommand>,
        status_sender: mpsc::Sender<TvStatus>,
    ) -> Self {
        // Initialize layer manager with default resolution and orientation
        let layer_manager = LayerManager::new(
            1920, 1080, // Default resolution - will be updated from config
            config.orientation.clone()
        );
        
        Self {
            config: Arc::new(RwLock::new(config)),
            state: Arc::new(RwLock::new(SlideshowState::Stopped)),
            current_index: Arc::new(RwLock::new(0)),
            all_images: Arc::new(RwLock::new(Vec::new())),
            images: Arc::new(RwLock::new(Vec::new())),
            command_receiver,
            status_sender,
            mqtt_client: Arc::new(RwLock::new(None)),
            couchdb_client: Arc::new(RwLock::new(None)),
            layer_manager: Arc::new(RwLock::new(layer_manager)),
            registration_status: Arc::new(RwLock::new(None)),
            start_time: Instant::now(),
            current_frame: Arc::new(RwLock::new(None)),
            manual_change_at: Arc::new(RwLock::new(None)),
            synced_layer_ids: Arc::new(RwLock::new(HashSet::new())),
            sequence_active: Arc::new(RwLock::new(false)),
            scene_layers: Arc::new(RwLock::new(HashMap::new())),
            overlay_values: Arc::new(RwLock::new(Vec::new())),
            scene_values: Arc::new(RwLock::new(Vec::new())),
            image_extensions: Arc::new(RwLock::new(HashMap::new())),
            snapshot_signatures: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn set_mqtt_client(&self, mqtt_client: MqttClient) {
        *self.mqtt_client.write().await = Some(mqtt_client);
    }

    pub async fn set_couchdb_client(&self, couchdb_client: CouchDbClient) {
        *self.couchdb_client.write().await = Some(couchdb_client);
    }

    pub async fn get_registration_status(&self) -> Option<RegistrationStatus> {
        self.registration_status.read().await.clone()
    }

    pub async fn initialize(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Try to initialize CouchDB client with timeout - but continue if it fails
        let config = self.config.read().await;
        match tokio::time::timeout(
            Duration::from_secs(5),
            CouchDbClient::new(
                &config.couchdb_url,
                config.couchdb_username.as_deref(),
                config.couchdb_password.as_deref(),
                &config.couchdb_database,
                &config.couchdb_images_database,
                &config.couchdb_layers_database,
            )
        ).await {
            Ok(Ok(couchdb_client)) => {
                println!("Connected to CouchDB at {}", config.couchdb_url);
                self.set_couchdb_client(couchdb_client).await;
            }
            Ok(Err(e)) => {
                eprintln!("Warning: Failed to connect to CouchDB: {}", e);
                println!("Continuing in local-only mode");
            }
            Err(_) => {
                eprintln!("Warning: CouchDB connection timeout after 5 seconds");
                println!("Continuing in local-only mode");
            }
        }
        drop(config);
        
        // Register with management system
        if let Err(e) = self.register_with_management_system().await {
            eprintln!("Warning: Failed to register with management system: {}", e);
            println!("Continuing without registration - TV may not appear in management UI");
        }
        
        // Load initial images from directory
        self.scan_local_images().await?;
        
        // Check if we have images before setting to playing
        if self.images.read().await.is_empty() {
            *self.state.write().await = SlideshowState::Stopped;
        } else {
            *self.state.write().await = SlideshowState::Playing;
        }
        
        // Fetch and apply configuration from CouchDB
        if let Some(ref couchdb_client) = *self.couchdb_client.read().await {
            let config = self.config.read().await;
            let tv_id = format!("tv_{}", config.tv_id);
            drop(config);
            
            if let Ok(Some(tv_config)) = couchdb_client.get_tv_config(&tv_id).await {
                let mut config = self.config.write().await;
                config.display_duration = Duration::from_millis(tv_config.display_duration);
                config.orientation = tv_config.orientation.clone();
                config.transition_effect = tv_config.transition_effect.clone();
                println!("Applied CouchDB config: {}ms display, {} orientation, {} transition", 
                         tv_config.display_duration, tv_config.orientation, tv_config.transition_effect);
                
                // Sync layer configuration to LayerManager
                let layer_config = couchdb_client.convert_to_layer_config(&tv_config, 1920, 1080);
                drop(config); // Release the lock before awaiting
                
                if let Err(e) = self.layer_manager.write().await.update_config(layer_config).await {
                    eprintln!("Failed to update layer config from CouchDB: {}", e);
                } else {
                    println!("✅ Synced layer configuration from CouchDB");
                }
            }
        }
        
        // Fetch Layer Control layers from CouchDB
        if let Err(e) = self.fetch_layers_from_couchdb().await {
            eprintln!("Warning: Failed to fetch layers from CouchDB: {}", e);
        }

        // The TV's sequence, or its image playlist if it has none
        self.refresh_playlist().await;

        // Update state after fetching from CouchDB
        let image_count = self.images.read().await.len();
        if image_count == 0 {
            *self.state.write().await = SlideshowState::Stopped;
            println!("No images available - slideshow stopped");
        } else {
            *self.state.write().await = SlideshowState::Playing;
            println!("Slideshow controller initialized with {} images", image_count);
        }
        
        Ok(())
    }

    async fn scan_local_images(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let config = self.config.read().await;
        let mut images = Vec::new();

        if let Ok(entries) = std::fs::read_dir(&config.image_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(ext) = path.extension() {
                    if ext.to_string_lossy().to_lowercase() == "png" || 
                       ext.to_string_lossy().to_lowercase() == "jpg" ||
                       ext.to_string_lossy().to_lowercase() == "jpeg" {
                        let image_info = ImageInfo {
                            id: path.file_stem()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .to_string(),
                            path: path.to_string_lossy().to_string(),
                            order: images.len() as u32,
                            url: None,
                            extension: path.extension().and_then(|ext| ext.to_str()).map(|s| format!(".{}", s)),
                            ..Default::default()
                        };
                        images.push(image_info);
                    }
                }
            }
        }

        images.sort_by(|a, b| a.order.cmp(&b.order));
        if !images.is_empty() {
            println!("Found {} local images", images.len());
        }
        drop(config);
        self.set_all_images(images).await;
        Ok(())
    }

    async fn fetch_images_from_couchdb(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let config = self.config.read().await;
        let tv_id = format!("tv_{}", config.tv_id);
        
        if let Some(ref couchdb_client) = *self.couchdb_client.read().await {
            let couchdb_images = couchdb_client.get_images_for_tv(&tv_id).await?;
            
            // Always replace local images when CouchDB is available - we only show what's assigned
            let mut local_images = Vec::new();

            if !couchdb_images.is_empty() {
                println!("Received {} images from CouchDB for {}", couchdb_images.len(), tv_id);

                for image_info in couchdb_images {
                    // Get extension from image info
                    let original_ext = image_info.extension
                        .as_deref()
                        .and_then(|ext| if ext.starts_with('.') { Some(&ext[1..]) } else { Some(ext) })
                        .unwrap_or("png");
                    
                    // Use image ID with original extension as local filename
                    let local_filename = format!("{}.{}", image_info.id, original_ext);
                    let local_path = Path::new(&config.image_dir).join(&local_filename);
                    
                    // Download image attachment from CouchDB if it doesn't exist locally
                    if !local_path.exists() {
                        if let Err(e) = couchdb_client.download_image_attachment(&image_info.id, &local_path.to_string_lossy()).await {
                            eprintln!("Failed to download image attachment {}: {}", image_info.id, e);
                            continue;
                        }
                    }

                    local_images.push(ImageInfo {
                        path: local_path.to_string_lossy().to_string(),
                        url: None, // Not needed for CouchDB attachments
                        ..image_info
                    });
                }

                local_images.sort_by(|a, b| a.order.cmp(&b.order));
                println!("Updated to {} images from CouchDB", local_images.len());
            } else {
                println!("No images assigned to {} in CouchDB", tv_id);
            }

            drop(config);
            self.set_all_images(local_images).await;
            Ok(())
        } else {
            Err("CouchDB client not initialized".into())
        }
    }

    pub async fn run_command_handler(&mut self) {
        loop {
            if let Ok(command) = self.command_receiver.recv().await {
                if let Err(e) = self.handle_command(command).await {
                    eprintln!("Error handling command: {}", e);
                    
                    if let Some(ref mqtt_client) = *self.mqtt_client.read().await {
                        let _ = mqtt_client.publish_error(&format!("Command error: {}", e)).await;
                    }
                }
            }
        }
    }

    async fn handle_command(&self, command: SlideshowCommand) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {

        match command {
            SlideshowCommand::Play => {
                *self.state.write().await = SlideshowState::Playing;
            }
            SlideshowCommand::Pause => {
                *self.state.write().await = SlideshowState::Paused;
            }
            SlideshowCommand::Next => {
                self.advance_to_next_image().await;
                *self.manual_change_at.write().await = Some(Instant::now());
            }
            SlideshowCommand::Previous => {
                self.advance_to_previous_image().await;
                *self.manual_change_at.write().await = Some(Instant::now());
            }
            SlideshowCommand::UpdateImages { images } => {
                if *self.sequence_active.read().await {
                    println!("Ignoring update_images: this TV plays a sequence");
                } else {
                    self.update_images(images).await?;
                }
            }
            SlideshowCommand::ShowImage { image_id, hold } => {
                if !self.show_image(&image_id).await {
                    return Err(format!("{} is not playing now (off, or outside its schedule)", image_id).into());
                }
                *self.manual_change_at.write().await = Some(Instant::now());
                *self.state.write().await = if hold { SlideshowState::Paused } else { SlideshowState::Playing };
                self.publish_current_image_to_mqtt().await;
            }
            SlideshowCommand::UpdateConfig { config } => {
                self.update_config(config).await;
            }
            SlideshowCommand::Reboot => {
                println!("Reboot command received - rebooting system...");
                std::process::Command::new("sudo").args(&["reboot"]).spawn()?;
            }
            SlideshowCommand::Shutdown => {
                println!("Shutdown command received - stopping slideshow");
                *self.state.write().await = SlideshowState::Stopped;
            }
            SlideshowCommand::AddLayer { layer } => {
                if let Err(e) = self.add_layer(layer).await {
                    eprintln!("Failed to add layer: {}", e);
                }
            }
            SlideshowCommand::RemoveLayer { layer_id } => {
                if let Err(e) = self.remove_layer(&layer_id).await {
                    eprintln!("Failed to remove layer: {}", e);
                }
            }
            SlideshowCommand::UpdateLayer { layer_id, layer } => {
                if let Err(e) = self.update_layer(&layer_id, layer).await {
                    eprintln!("Failed to update layer: {}", e);
                }
            }
            SlideshowCommand::SetLayerVisibility { layer_id, visible } => {
                if let Err(e) = self.set_layer_visibility(&layer_id, visible).await {
                    eprintln!("Failed to set layer visibility: {}", e);
                }
            }
            SlideshowCommand::SetLayerOpacity { layer_id, opacity } => {
                if let Err(e) = self.set_layer_opacity(&layer_id, opacity).await {
                    eprintln!("Failed to set layer opacity: {}", e);
                }
            }
            SlideshowCommand::AnimateLayer { layer_id, animation_type, duration_ms, distance } => {
                if let Some(mut layer) = self.get_layer(&layer_id).await {
                    match animation_type.as_str() {
                        "slide_up" => layer.start_slide_up(distance.unwrap_or(100.0), duration_ms),
                        "slide_down" => layer.start_slide_down(distance.unwrap_or(100.0), duration_ms),
                        "slide_left" => layer.start_slide_left(distance.unwrap_or(100.0), duration_ms),
                        "slide_right" => layer.start_slide_right(distance.unwrap_or(100.0), duration_ms),
                        "fade_in" => layer.start_fade_in(duration_ms),
                        "fade_out" => layer.start_fade_out(duration_ms),
                        _ => eprintln!("Unknown animation type: {}", animation_type),
                    }
                    if let Err(e) = self.update_layer(&layer_id, layer).await {
                        eprintln!("Failed to update layer after animation: {}", e);
                    }
                } else {
                    eprintln!("Layer not found for animation: {}", layer_id);
                }
            }
            SlideshowCommand::SyncLayers { layers } => {
                // Also the server's signal that the TV's sequence, a scene in it, or a
                // data set changed
                self.sync_layers(layers).await;
                self.refresh_playlist().await;
            }
            SlideshowCommand::SyncAlerts { alerts } => {
                if let Err(e) = self.sync_alerts(alerts).await {
                    eprintln!("Failed to sync alerts: {}", e);
                }
            }
        }

        // Send status update
        self.send_status_update().await;
        
        Ok(())
    }

    pub async fn advance_to_next_image(&self) {
        let images = self.images.read().await;
        if !images.is_empty() {
            let mut current_index = self.current_index.write().await;
            *current_index = (*current_index + 1) % images.len();
        }
    }

    pub async fn advance_to_previous_image(&self) {
        let images = self.images.read().await;
        if !images.is_empty() {
            let mut current_index = self.current_index.write().await;
            *current_index = if *current_index == 0 {
                images.len() - 1
            } else {
                *current_index - 1
            };
        }
    }

    /// Jump to a specific image by ID. Returns false if it isn't in the playlist.
    /// Jump to a clip (by clip id) or image (by image id)
    pub async fn show_image(&self, id: &str) -> bool {
        let images = self.images.read().await;
        match images.iter().position(|img| img.key() == id || img.id == id) {
            Some(position) => {
                *self.current_index.write().await = position;
                true
            }
            None => false,
        }
    }

    fn current_image_id(images: &[ImageInfo], index: usize) -> Option<String> {
        images.get(index).map(|img| img.key().to_string())
    }

    /// Replace everything assigned to this TV, then show what's scheduled now
    async fn set_all_images(&self, all_images: Vec<ImageInfo>) {
        *self.all_images.write().await = all_images;
        self.apply_schedules().await;
    }

    /// Narrow the playlist to images whose schedule is active right now.
    /// Returns true if the playlist changed.
    async fn apply_schedules(&self) -> bool {
        let now = chrono::Local::now().fixed_offset();
        let active = Self::scheduled_images(&self.all_images.read().await, &now);

        let mut images = self.images.write().await;
        if *images == active {
            return false;
        }

        // Keep showing the same image if it's still in the playlist
        let mut current_index = self.current_index.write().await;
        let previous_id = Self::current_image_id(&images, *current_index);
        *images = active;
        Self::restore_current_index(&images, &mut current_index, previous_id);
        true
    }

    fn scheduled_images(all_images: &[ImageInfo], now: &chrono::DateTime<chrono::FixedOffset>) -> Vec<ImageInfo> {
        all_images.iter().filter(|img| img.is_scheduled_at(now)).cloned().collect()
    }

    pub async fn run_schedule_checks(&self) {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            if !self.apply_schedules().await {
                continue;
            }

            let count = self.images.read().await.len();
            println!("🗓️ Schedule changed the playlist: {} image(s) showing now", count);
            // A playlist that was empty (stopped) starts playing once something is scheduled
            if count > 0 && matches!(*self.state.read().await, SlideshowState::Stopped) {
                *self.state.write().await = SlideshowState::Playing;
            }
            self.send_status_update().await;
        }
    }

    /// After the playlist is replaced, point back at the image that was showing
    /// (so a reorder or newly enabled image doesn't swap out a held image).
    fn restore_current_index(images: &[ImageInfo], current_index: &mut usize, previous_id: Option<String>) {
        if let Some(position) = previous_id.and_then(|id| images.iter().position(|img| img.key() == id)) {
            *current_index = position;
        } else if *current_index >= images.len() {
            *current_index = 0;
        }
    }

    async fn update_images(&self, new_images: Vec<ImageInfo>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let config = self.config.read().await;

        println!("Updating images: received {} new images", new_images.len());

        // Download new images from CouchDB
        if let Some(ref couchdb_client) = *self.couchdb_client.read().await {
            for image_info in &new_images {
                // Get extension from image info
                let original_ext = image_info.extension
                    .as_deref()
                    .and_then(|ext| if ext.starts_with('.') { Some(&ext[1..]) } else { Some(ext) })
                    .unwrap_or("png");
                
                // Use image ID with original extension as local filename
                let local_filename = format!("{}.{}", image_info.id, original_ext);
                let local_path = Path::new(&config.image_dir).join(&local_filename);
                
                if !local_path.exists() {
                    if let Err(e) = couchdb_client.download_image_attachment(&image_info.id, &local_path.to_string_lossy()).await {
                        eprintln!("Failed to download image attachment {}: {}", image_info.id, e);
                        continue;
                    }
                }
            }
        }

        // Update image list with corrected local paths
        let mut updated_images = Vec::new();
        for image_info in new_images {
            // Get extension from image info
            let original_ext = image_info.extension
                .as_deref()
                .and_then(|ext| if ext.starts_with('.') { Some(&ext[1..]) } else { Some(ext) })
                .unwrap_or("png");
            
            let local_filename = format!("{}.{}", image_info.id, original_ext);
            let local_path = Path::new(&config.image_dir).join(&local_filename);
            
            updated_images.push(ImageInfo {
                path: local_path.to_string_lossy().to_string(),
                url: None, // Not needed for CouchDB attachments
                ..image_info
            });
        }

        updated_images.sort_by(|a, b| a.order.cmp(&b.order));
        drop(config);
        self.set_all_images(updated_images).await;

        // Update state based on image availability
        let images = self.images.read().await;
        if images.is_empty() {
            *self.state.write().await = SlideshowState::Stopped;
            println!("Image list updated: 0 images - slideshow stopped");
        } else {
            *self.state.write().await = SlideshowState::Playing;
            println!("Image list updated: {} images - slideshow playing", images.len());
        }
        
        Ok(())
    }

    async fn update_config(&self, new_config: SlideshowConfig) {
        let mut config = self.config.write().await;
        
        if let Some(duration) = new_config.display_duration {
            println!("Updating display duration from {}ms to {}ms", config.display_duration.as_millis(), duration);
            config.display_duration = Duration::from_millis(duration);
        }
        
        if let Some(transition) = new_config.transition_duration {
            println!("Updating transition duration from {}ms to {}ms", config.transition_duration.as_millis(), transition);
            config.transition_duration = Duration::from_millis(transition);
        }
        
        if let Some(orientation) = new_config.orientation {
            println!("🔄 ORIENTATION UPDATE: Updating orientation from {} to {}", config.orientation, orientation);
            config.orientation = orientation.clone();
            println!("🔄 ORIENTATION UPDATED: New orientation set to {}", orientation);
        }
        
        if let Some(transition_effect) = new_config.transition_effect {
            println!("🔄 TRANSITION UPDATE: Updating transition effect from {} to {}", config.transition_effect, transition_effect);
            config.transition_effect = transition_effect.clone();
            println!("🔄 TRANSITION UPDATED: New transition effect set to {}", transition_effect);
        }
    }

    async fn send_status_update(&self) {
        let state = self.state.read().await;
        let current_index = *self.current_index.read().await;
        let images = self.images.read().await;
        
        let current = images.get(current_index);
        let current_image = current.and_then(|img| img.image_id()).map(str::to_string);
        let status_str = match *state {
            SlideshowState::Playing => "playing".to_string(),
            SlideshowState::Paused => "paused".to_string(),
            SlideshowState::Stopped => "stopped".to_string(),
        };
        
        let status = TvStatus {
            status: status_str.clone(),
            current_image: current_image.clone(),
            current_clip: current.and_then(|img| img.clip_id.clone()),
            current_scene: current.and_then(|img| img.scene_id.clone()),
            total_images: images.len(),
            current_index,
            uptime: self.start_time.elapsed().as_secs(),
            timestamp: chrono::Utc::now().to_rfc3339(),
        };

        if let Err(e) = self.status_sender.send(status.clone()).await {
            eprintln!("Failed to send status update: {}", e);
        }

        // Also publish to MQTT if available
        if let Some(ref mqtt_client) = *self.mqtt_client.read().await {
            if let Err(e) = mqtt_client.publish_status(&status).await {
                eprintln!("Failed to publish status to MQTT: {}", e);
            }
        }

        // Update TV status in CouchDB
        if let Some(ref couchdb_client) = *self.couchdb_client.read().await {
            let config = self.config.read().await;
            let tv_id = format!("tv_{}", config.tv_id);
            let local_ip = Self::get_local_ip();
            if let Err(e) = couchdb_client.update_tv_status(&tv_id, &status_str, current_image.as_deref(), local_ip.as_deref()).await {
                eprintln!("Failed to update TV status in CouchDB: {}", e);
            }
        }
    }

    pub async fn get_current_image_path(&self) -> Option<PathBuf> {
        let current_index = *self.current_index.read().await;
        let images = self.images.read().await;
        
        images.get(current_index).map(|img| PathBuf::from(&img.path))
    }

    pub async fn get_state(&self) -> SlideshowState {
        self.state.read().await.clone()
    }

    pub async fn is_playing(&self) -> bool {
        matches!(*self.state.read().await, SlideshowState::Playing)
    }

    pub async fn should_advance_automatically(&self, last_change: Instant) -> bool {
        if !self.is_playing().await {
            return false;
        }

        // Count from the later of the last automatic advance and the last manual change
        let since = match *self.manual_change_at.read().await {
            Some(manual) if manual > last_change => manual,
            _ => last_change,
        };

        since.elapsed() >= self.current_display_duration().await
    }

    /// The showing image's own display time, falling back to the TV's
    async fn current_display_duration(&self) -> Duration {
        let index = *self.current_index.read().await;
        let image_duration = self.images.read().await.get(index).and_then(|img| img.display_duration);
        match image_duration {
            Some(ms) => Duration::from_millis(ms),
            None => self.config.read().await.display_duration,
        }
    }


    pub async fn publish_current_image_to_mqtt(&self) {
        if let Some(ref mqtt_client) = *self.mqtt_client.read().await {
            let current_index = *self.current_index.read().await;
            let images = self.images.read().await;
            
            if let Some(current_image) = images.get(current_index) {
                if let Err(e) = mqtt_client.publish_current_image(current_image).await {
                    eprintln!("Failed to publish current image to MQTT: {}", e);
                }
            }
        }
    }

    pub async fn get_image_count(&self) -> usize {
        self.images.read().await.len()
    }

    pub async fn get_image_list(&self) -> Vec<ImageInfo> {
        self.images.read().await.clone()
    }

    pub async fn get_tv_id(&self) -> String {
        self.config.read().await.tv_id.clone()
    }

    pub async fn get_orientation(&self) -> String {
        self.config.read().await.orientation.clone()
    }

    pub async fn get_transition_effect(&self) -> String {
        self.config.read().await.transition_effect.clone()
    }

    pub async fn get_transition_duration(&self) -> Duration {
        self.config.read().await.transition_duration
    }

    pub async fn run_periodic_tasks(&self) {
        let mut interval = tokio::time::interval(Duration::from_secs(300)); // 5 minutes
        
        loop {
            interval.tick().await;
            
            // Periodically sync config from CouchDB
            if let Some(ref couchdb_client) = *self.couchdb_client.read().await {
                let config = self.config.read().await;
                let tv_id = format!("tv_{}", config.tv_id);
                drop(config);
                
                if let Ok(Some(tv_config)) = couchdb_client.get_tv_config(&tv_id).await {
                    let mut config = self.config.write().await;
                    let old_orientation = config.orientation.clone();
                    let old_transition = config.transition_effect.clone();
                    config.display_duration = Duration::from_millis(tv_config.display_duration);
                    config.orientation = tv_config.orientation.clone();
                    config.transition_effect = tv_config.transition_effect.clone();
                    
                    if old_orientation != tv_config.orientation {
                        println!("🔄 COUCHDB CONFIG SYNC: Orientation changed from {} to {}", old_orientation, tv_config.orientation);
                    }
                    if old_transition != tv_config.transition_effect {
                        println!("🔄 COUCHDB CONFIG SYNC: Transition effect changed from {} to {}", old_transition, tv_config.transition_effect);
                    }
                    
                    // Sync layer configuration to LayerManager
                    let layer_config = couchdb_client.convert_to_layer_config(&tv_config, 1920, 1080);
                    drop(config); // Release the lock before awaiting
                    
                    if let Err(e) = self.layer_manager.write().await.update_config(layer_config).await {
                        eprintln!("Failed to update layer config during periodic sync: {}", e);
                    } else {
                        println!("🔄 Synced layer configuration during periodic update");
                    }
                }
            }
            
            // Periodically sync with CouchDB
            if let Err(e) = self.fetch_layers_from_couchdb().await {
                eprintln!("Failed to sync layers with CouchDB: {}", e);
            }
            self.refresh_playlist().await;

            // Send status update
            self.send_status_update().await;
        }
    }

    async fn register_with_management_system(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let config = self.config.read().await;
        
        // Check if TV already exists in CouchDB to preserve orientation
        let existing_orientation = if let Some(ref couchdb_client) = *self.couchdb_client.read().await {
            let tv_id = format!("tv_{}", config.tv_id);
            if let Ok(Some(tv_config)) = couchdb_client.get_tv_config(&tv_id).await {
                println!("Found existing TV config, preserving orientation: {}", tv_config.orientation);
                tv_config.orientation
            } else {
                println!("No existing TV config found, using default orientation: {}", config.orientation);
                config.orientation.clone()
            }
        } else {
            println!("No CouchDB client available, using current orientation: {}", config.orientation);
            config.orientation.clone()
        };
        
        // Extract management server URL from CouchDB URL (assume same host, different port)
        let management_url = if config.couchdb_url.contains("localhost") || config.couchdb_url.contains("127.0.0.1") {
            "http://localhost:3000".to_string()
        } else {
            // Extract hostname from CouchDB URL and use port 3000
            let url = url::Url::parse(&config.couchdb_url)?;
            if let Some(host) = url.host_str() {
                format!("http://{}:3000", host)
            } else {
                return Err("Could not extract hostname from CouchDB URL".into());
            }
        };
        
        // Get hostname with timeout
        let hostname = tokio::time::timeout(
            Duration::from_secs(2),
            tokio::task::spawn_blocking(|| {
                std::process::Command::new("hostname")
                    .output()
                    .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
                    .unwrap_or_else(|_| "unknown-pi".to_string())
            })
        ).await.unwrap_or_else(|_| Ok("timeout-pi".to_string()))?;
        
        // Get local IP address with timeout
        let local_ip = tokio::time::timeout(
            Duration::from_secs(3),
            tokio::task::spawn_blocking(|| Self::get_local_ip())
        ).await.unwrap_or_else(|_| Ok(None))?.unwrap_or_else(|| "127.0.0.1".to_string());
        
        // Prepare registration data with preserved orientation
        let registration_data = serde_json::json!({
            "tv_id": format!("tv_{}", config.tv_id),
            "hostname": hostname,
            "ip_address": local_ip,
            "platform": "raspberry-pi",
            "version": env!("CARGO_PKG_VERSION"),
            "orientation": existing_orientation
        });
        
        // Send registration request
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()?;
            
        let registration_url = format!("{}/api/tvs/register", management_url);
        println!("Registering TV with management system at {}", registration_url);
        
        let response = client
            .post(&registration_url)
            .json(&registration_data)
            .send()
            .await?;
            
        if response.status().is_success() {
            let result: serde_json::Value = response.json().await?;
            let is_new = result["isNew"].as_bool().unwrap_or(false);
            let tv_id_full = format!("tv_{}", config.tv_id);

            // Store registration status
            *self.registration_status.write().await = Some(RegistrationStatus {
                is_new,
                tv_id: tv_id_full.clone(),
                ip_address: local_ip.clone(),
            });

            if is_new {
                println!("Successfully registered as new TV: {}", config.tv_id);
            } else {
                println!("Successfully re-registered existing TV: {} (preserved orientation: {})", config.tv_id, existing_orientation);
            }
        } else {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(format!("Registration failed with status {}: {}", status, error_text).into());
        }

        Ok(())
    }

    fn get_local_ip() -> Option<String> {
        use std::net::TcpStream;
        use std::time::Duration;
        
        // Try to connect to a remote address to determine local IP with timeout
        match TcpStream::connect_timeout(
            &"8.8.8.8:80".parse().unwrap(),
            Duration::from_secs(2)
        ) {
            Ok(stream) => {
                if let Ok(local_addr) = stream.local_addr() {
                    return Some(local_addr.ip().to_string());
                }
            }
            Err(_) => {
                // Connection failed, continue to fallback
            }
        }
        
        // Fallback: try to get IP from network interfaces with timeout
        use std::process::Command;
        match std::thread::spawn(|| {
            Command::new("hostname").arg("-I").output()
        }).join() {
            Ok(Ok(output)) => {
                if let Ok(ip_str) = String::from_utf8(output.stdout) {
                    if let Some(ip) = ip_str.split_whitespace().next() {
                        return Some(ip.to_string());
                    }
                }
            }
            _ => {
                // Command failed or thread panicked
            }
        }
        
        None
    }

    // Layer management methods for Phase 2
    pub async fn add_layer(&self, layer: Layer) -> Result<(), String> {
        self.layer_manager.write().await.add_layer(layer).await
    }

    pub async fn remove_layer(&self, id: &str) -> Result<(), String> {
        self.layer_manager.write().await.remove_layer(id).await
    }

    pub async fn update_layer(&self, id: &str, layer: Layer) -> Result<(), String> {
        self.layer_manager.write().await.update_layer(id, layer).await
    }

    pub async fn set_layer_visibility(&self, id: &str, visible: bool) -> Result<(), String> {
        self.layer_manager.write().await.set_layer_visibility(id, visible).await
    }

    pub async fn set_layer_opacity(&self, id: &str, opacity: f32) -> Result<(), String> {
        self.layer_manager.write().await.set_layer_opacity(id, opacity).await
    }

    pub async fn get_layer(&self, id: &str) -> Option<Layer> {
        self.layer_manager.read().await.get_layer(id).await
    }

    /// Get all layers (for future HTTP API)
    #[allow(dead_code)]
    pub async fn get_all_layers(&self) -> Vec<Layer> {
        self.layer_manager.read().await.get_all_layers().await
    }

    /// Get layer configuration (for future HTTP API)
    #[allow(dead_code)]
    pub async fn get_layer_config(&self) -> LayerConfig {
        self.layer_manager.read().await.get_config().await
    }

    /// Update layer configuration (for future HTTP API)
    #[allow(dead_code)]
    pub async fn update_layer_config(&self, config: LayerConfig) -> Result<(), String> {
        self.layer_manager.write().await.update_config(config).await
    }

    async fn fetch_layers_from_couchdb(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let tv_id = format!("tv_{}", self.config.read().await.tv_id);
        let layers = match *self.couchdb_client.read().await {
            Some(ref couchdb_client) => couchdb_client.get_layers_for_tv(&tv_id).await?,
            None => return Err("CouchDB client not initialized".into()),
        };
        self.sync_layers(layers).await;
        Ok(())
    }

    /// Replace the Layer Control layers with the server's list for this TV.
    /// Alert layers and the TV-config layers (slideshow, logo) are left alone.
    pub async fn sync_layers(&self, server_layers: Vec<serde_json::Value>) {
        let image_dir = self.config.read().await.image_dir.clone();
        *self.overlay_values.write().await = server_layers.clone();
        let all_values = self.all_layer_values().await;
        self.download_layer_images(&all_values, &image_dir).await;
        self.load_layer_data(&all_values).await;

        let layers: Vec<Layer> = server_layers
            .iter()
            .filter_map(|value| Self::server_layer_to_layer(value, &image_dir))
            .collect();
        let incoming: HashSet<String> = layers.iter().map(|layer| layer.id.clone()).collect();

        let layer_manager = self.layer_manager.write().await;
        let mut synced = self.synced_layer_ids.write().await;

        for id in synced.difference(&incoming) {
            if let Err(e) = layer_manager.remove_layer(id).await {
                eprintln!("Failed to remove layer {}: {}", id, e);
            }
        }

        for layer in layers {
            let id = layer.id.clone();
            let result = if layer_manager.get_layer(&id).await.is_some() {
                layer_manager.update_layer(&id, layer).await
            } else {
                layer_manager.add_layer(layer).await
            };
            if let Err(e) = result {
                eprintln!("Failed to apply layer {}: {}", id, e);
            }
        }

        println!("🧱 Synced {} Layer Control layer(s)", incoming.len());
        *synced = incoming;
    }

    /// Where a layer's Image Library image is cached on this TV
    fn layer_image_path(image_dir: &Path, image_id: &str) -> PathBuf {
        image_dir.join(format!("{}.layerimg", image_id))
    }

    fn layer_image_id(value: &serde_json::Value) -> Option<&str> {
        value["content"]["image_id"].as_str().filter(|id| !id.is_empty())
    }

    /// Weather values for {tokens} and the rows of every data set a table layer
    /// shows. If CouchDB can't be reached, the last data stays on screen.
    async fn load_layer_data(&self, server_layers: &[serde_json::Value]) {
        let couchdb_client = self.couchdb_client.read().await;
        let Some(couchdb_client) = couchdb_client.as_ref() else { return };

        let mut data = LayerData::default();
        match couchdb_client.get_dataset("weather").await {
            Ok(Some(weather)) => {
                if let Some(values) = weather["values"].as_object() {
                    for (name, value) in values {
                        if let Some(value) = value.as_str() {
                            data.values.insert(name.clone(), value.to_string());
                        }
                    }
                }
            }
            Ok(None) => {}
            Err(e) => {
                eprintln!("Failed to load weather data: {}", e);
                return;
            }
        }

        let dataset_ids: HashSet<&str> = server_layers.iter()
            .filter_map(|layer| layer["content"]["table"]["dataset"].as_str())
            .collect();
        for id in dataset_ids {
            match couchdb_client.get_dataset(id).await {
                Ok(dataset) => {
                    let rows = dataset.and_then(|d| d["rows"].as_array().cloned()).unwrap_or_default();
                    println!("📊 Loaded data set {} ({} rows)", id, rows.len());
                    data.datasets.insert(id.to_string(), rows);
                }
                Err(e) => {
                    eprintln!("Failed to load data set {}: {}", id, e);
                    return;
                }
            }
        }

        self.layer_manager.read().await.set_data(data).await;
    }

    /// Fetch any layer images not already cached locally
    async fn download_layer_images(&self, server_layers: &[serde_json::Value], image_dir: &Path) {
        let couchdb_client = self.couchdb_client.read().await;
        let Some(couchdb_client) = couchdb_client.as_ref() else { return };

        for image_id in server_layers.iter().filter_map(Self::layer_image_id) {
            let path = Self::layer_image_path(image_dir, image_id);
            if path.exists() {
                continue;
            }
            if let Err(e) = couchdb_client.download_image_attachment(image_id, &path.to_string_lossy()).await {
                eprintln!("Failed to download layer image {}: {}", image_id, e);
            }
        }
    }

    /// Convert a server Layer document into a renderable layer: its Image
    /// Library image if it has one, otherwise a text/colour block.
    fn server_layer_to_layer(value: &serde_json::Value, image_dir: &Path) -> Option<Layer> {
        let id = value["layer_id"].as_str()?.to_string();
        let content = &value["content"];
        let position = &value["position"];
        let as_u32 = |v: &serde_json::Value, default: u32| v.as_f64().map(|n| n.max(0.0) as u32).unwrap_or(default);

        let mut layer = Layer::new(id, LayerType::DataRow)
            .with_position(
                as_u32(&position["x"], 0),
                as_u32(&position["y"], 0),
                as_u32(&position["width"], 1920),
                as_u32(&position["height"], 60),
            )
            .with_opacity(value["opacity"].as_f64().unwrap_or(1.0) as f32)
            .with_priority(value["priority"].as_u64().unwrap_or(15).min(255) as u8)
            .with_data_row(
                content["text"].as_str().unwrap_or("").to_string(),
                parse_rgba_string(content["backgroundColor"].as_str().unwrap_or("rgba(0, 0, 0, 0.8)")),
                parse_rgba_string(content["textColor"].as_str().unwrap_or("rgba(255, 255, 255, 1)")),
                content["fontSize"].as_u64().unwrap_or(24) as u32,
                content["alignment"].as_str().unwrap_or("left").to_string(),
            )
            .with_vertical_alignment(content["verticalAlignment"].as_str().unwrap_or("middle"))
            .with_font(
                content["fontFamily"].as_str().unwrap_or(""),
                content["fontWeight"].as_str() == Some("bold"),
            );
        if let Ok(mut spec) = serde_json::from_value::<TableSpec>(content["table"].clone()) {
            if !spec.dataset.is_empty() {
                if spec.font_family.is_empty() {
                    spec.font_family = content["fontFamily"].as_str().unwrap_or("").to_string();
                }
                layer.content = LayerContent::Table(spec);
            }
        }
        if let Some(image_id) = Self::layer_image_id(value) {
            layer.content = LayerContent::ImagePath(Self::layer_image_path(image_dir, image_id).to_string_lossy().to_string());
        }
        layer.visible = value["visible"].as_bool().unwrap_or(true);
        if let Some(name) = value["name"].as_str() {
            layer = layer.with_name(name.to_string());
        }
        Some(layer)
    }

    pub async fn layers_need_redraw(&self) -> bool {
        self.layer_manager.read().await.needs_redraw().await
    }

    /// Sync alerts from server state - adds new alerts, removes dismissed ones
    pub async fn sync_alerts(&self, alerts: Vec<AlertData>) -> Result<(), String> {
        let layer_manager = self.layer_manager.write().await;

        // Get current emergency layer IDs
        let current_ids: HashSet<String> = layer_manager
            .get_emergency_layer_ids()
            .await;

        // Get incoming alert IDs
        let incoming_ids: HashSet<String> = alerts
            .iter()
            .map(|a| a.alert_id.clone())
            .collect();

        // Remove layers no longer in active list
        for id in current_ids.difference(&incoming_ids) {
            println!("🗑️ Removing stale alert layer: {}", id);
            layer_manager.remove_layer(id).await?;
        }

        // Add new alerts (auto-stacked by layer_manager)
        for alert in alerts {
            if !current_ids.contains(&alert.alert_id) {
                let layer = self.alert_data_to_layer(&alert);
                println!("➕ Adding new alert layer: {} ({})", alert.alert_id, alert.alert_type);
                layer_manager.add_layer(layer).await?;
            }
        }

        Ok(())
    }

    /// Convert AlertData to Layer
    fn alert_data_to_layer(&self, alert: &AlertData) -> Layer {
        let content = &alert.layer.content;
        let position = &alert.layer.position;

        // Parse colors from CSS rgba() strings
        let bg_color_str = content["backgroundColor"]
            .as_str()
            .unwrap_or("rgba(220, 38, 38, 0.95)");
        let bg_color = parse_rgba_string(bg_color_str);

        let text_color_str = content["textColor"]
            .as_str()
            .unwrap_or("rgba(255, 255, 255, 1)");
        let text_color = parse_rgba_string(text_color_str);

        // Extract text content
        let text = content["text"]
            .as_str()
            .unwrap_or("EMERGENCY ALERT")
            .to_string();

        // Extract font size and alignment
        let font_size = content["fontSize"].as_u64().unwrap_or(32) as u32;
        let alignment = content["alignment"]
            .as_str()
            .unwrap_or("center")
            .to_string();

        // Extract position (Y will be overridden by auto-stacking)
        let x = position["x"].as_u64().unwrap_or(0) as u32;
        let y = position["y"].as_u64().unwrap_or(0) as u32;
        let width = position["width"].as_u64().unwrap_or(1920) as u32;
        let height = position["height"].as_u64().unwrap_or(120) as u32;

        Layer::new(alert.alert_id.clone(), LayerType::Emergency)
            .with_position(x, y, width, height)
            .with_data_row(text, bg_color, text_color, font_size, alignment)
    }

    pub async fn render_composite_image(&self) -> Result<image::RgbaImage, String> {
        self.layer_manager.read().await.render_composite().await
    }

    /// Get the current composite image for preview streaming
    /// This returns the current_frame which is updated during transitions and compositing
    pub async fn get_current_composite(&self) -> Option<image::RgbaImage> {
        self.current_frame.read().await.clone()
    }

    /// Get the current frame buffer Arc for external updates (e.g., during transitions)
    pub fn get_current_frame(&self) -> Arc<RwLock<Option<image::RgbaImage>>> {
        self.current_frame.clone()
    }

    /// Update the current frame buffer with a new image
    pub async fn set_current_frame(&self, frame: image::RgbaImage) {
        *self.current_frame.write().await = Some(frame);
    }

    /// Put the current clip on screen: an image on the slideshow layer, or a
    /// scene's elements in the base band (with an empty slideshow layer)
    pub async fn apply_current_clip(&self) -> Result<(), String> {
        let item = {
            let images = self.images.read().await;
            images.get(*self.current_index.read().await).cloned()
        };
        let scene = match item.as_ref().and_then(|item| item.scene_id.as_ref()) {
            Some(scene_id) => Some(self.scene_layers.read().await.get(scene_id).cloned().unwrap_or_default()),
            None => None,
        };
        let layer_manager = self.layer_manager.write().await;
        match (item, scene) {
            (Some(_), Some(layers)) => {
                layer_manager.update_slideshow_content(None).await?;
                layer_manager.set_base_layers(layers).await;
            }
            (Some(item), None) => {
                layer_manager.update_slideshow_content(Some(item.path)).await?;
                layer_manager.set_base_layers(Vec::new()).await;
            }
            (None, _) => layer_manager.set_base_layers(Vec::new()).await,
        }
        Ok(())
    }

    /// Re-render the snapshots of scene clips at `index` and the one after it, so
    /// a transition starts from / lands on what the scene shows now
    pub async fn refresh_scene_snapshots(&self, index: usize) {
        let items: Vec<ImageInfo> = {
            let images = self.images.read().await;
            if images.is_empty() {
                return;
            }
            [index % images.len(), (index + 1) % images.len()].iter().map(|&i| images[i].clone()).collect()
        };
        for item in items {
            if let Some(scene_id) = &item.scene_id {
                self.save_scene_snapshot(scene_id, &item.path).await;
            }
        }
    }

    async fn save_scene_snapshot(&self, scene_id: &str, path: &str) {
        let layers = self.scene_layers.read().await.get(scene_id).cloned().unwrap_or_default();
        let frame = self.layer_manager.read().await.render_scene_snapshot(&layers).await;
        let path = path.to_string();
        // PNG encoding is CPU work; keep it off the async workers
        let result = tokio::task::spawn_blocking(move || frame.save_with_format(&path, image::ImageFormat::Png)).await;
        if let Ok(Err(e)) | Err(e) = result.map_err(|e| image::ImageError::IoError(std::io::Error::new(std::io::ErrorKind::Other, e))) {
            eprintln!("Failed to save snapshot for scene {}: {}", scene_id, e);
        }
    }

    async fn all_layer_values(&self) -> Vec<serde_json::Value> {
        let mut values = self.overlay_values.read().await.clone();
        values.extend(self.scene_values.read().await.iter().cloned());
        values
    }

    /// Play the TV's sequence if it has one; otherwise its image playlist
    pub async fn refresh_playlist(&self) {
        match self.load_sequence().await {
            Ok(true) => {}
            Ok(false) => {
                if *self.sequence_active.read().await {
                    println!("🎞️ No sequence assigned any more; back to the image playlist");
                }
                *self.sequence_active.write().await = false;
                self.scene_values.write().await.clear();
                if let Err(e) = self.fetch_images_from_couchdb().await {
                    eprintln!("Failed to fetch images from CouchDB: {}", e);
                }
            }
            // Keep playing what we have (e.g. CouchDB unreachable)
            Err(e) => eprintln!("Failed to load sequence: {}", e),
        }
    }

    /// Build the play list from the TV's sequence. Ok(false) when none is assigned.
    async fn load_sequence(&self) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let (tv_id, image_dir) = {
            let config = self.config.read().await;
            (format!("tv_{}", config.tv_id), config.image_dir.clone())
        };

        let mut items = Vec::new();
        let mut scene_docs: HashMap<String, Vec<serde_json::Value>> = HashMap::new();
        let sequence_name;
        {
            let couchdb_client = self.couchdb_client.read().await;
            let Some(couchdb_client) = couchdb_client.as_ref() else { return Ok(false) };
            let Some(sequence) = couchdb_client.get_sequence_for_tv(&tv_id).await? else { return Ok(false) };
            sequence_name = sequence["name"].as_str().unwrap_or("sequence").to_string();
            let clips = sequence["clips"].as_array().cloned().unwrap_or_default();

            for (order, clip) in clips.iter().enumerate() {
                if clip["enabled"].as_bool() == Some(false) {
                    continue;
                }
                let (Some(clip_id), Some(source)) = (clip["clip_id"].as_str(), clip["ref"].as_str()) else { continue };
                let mut item = ImageInfo {
                    id: source.to_string(),
                    order: order as u32,
                    display_duration: clip["duration_ms"].as_u64(),
                    schedule: serde_json::from_value(clip["schedule"].clone()).ok().flatten(),
                    clip_id: Some(clip_id.to_string()),
                    ..Default::default()
                };

                if clip["kind"].as_str() == Some("scene") {
                    if !scene_docs.contains_key(source) {
                        match couchdb_client.get_layers_doc(source).await? {
                            Some(scene) => {
                                scene_docs.insert(source.to_string(), scene["elements"].as_array().cloned().unwrap_or_default());
                            }
                            None => {
                                eprintln!("Sequence clip {}: scene {} no longer exists", clip_id, source);
                                continue;
                            }
                        }
                    }
                    item.scene_id = Some(source.to_string());
                    item.path = image_dir.join(format!("scene-{}.png", source)).to_string_lossy().to_string();
                } else {
                    let known = self.image_extensions.read().await.get(source).cloned();
                    let extension = match known {
                        Some(extension) => extension,
                        None => match couchdb_client.get_image_extension(source).await? {
                            Some(extension) => {
                                self.image_extensions.write().await.insert(source.to_string(), extension.clone());
                                extension
                            }
                            None => {
                                eprintln!("Sequence clip {}: image {} no longer exists", clip_id, source);
                                continue;
                            }
                        },
                    };
                    let path = image_dir.join(format!("{}{}", source, extension));
                    if !path.exists() {
                        if let Err(e) = couchdb_client.download_image_attachment(source, &path.to_string_lossy()).await {
                            eprintln!("Failed to download image {}: {}", source, e);
                            continue;
                        }
                    }
                    item.path = path.to_string_lossy().to_string();
                    item.extension = Some(extension);
                }
                items.push(item);
            }
        }

        // Scene elements: ready-to-draw layers, plus their images and data sets
        *self.scene_values.write().await = scene_docs.values().flatten().cloned().collect();
        let all_values = self.all_layer_values().await;
        self.download_layer_images(&all_values, &image_dir).await;
        self.load_layer_data(&all_values).await;
        *self.scene_layers.write().await = scene_docs.iter()
            .map(|(id, elements)| (id.clone(), elements.iter().filter_map(|e| Self::server_layer_to_layer(e, &image_dir)).collect()))
            .collect();
        // Snapshots only for scenes whose content changed (live values are
        // refreshed again just before each transition)
        for (scene_id, elements) in &scene_docs {
            let signature = {
                use std::hash::{Hash, Hasher};
                let mut hasher = std::collections::hash_map::DefaultHasher::new();
                serde_json::to_string(elements).unwrap_or_default().hash(&mut hasher);
                hasher.finish()
            };
            let path = image_dir.join(format!("scene-{}.png", scene_id));
            if self.snapshot_signatures.read().await.get(scene_id) != Some(&signature) || !path.exists() {
                self.save_scene_snapshot(scene_id, &path.to_string_lossy()).await;
                self.snapshot_signatures.write().await.insert(scene_id.clone(), signature);
            }
        }

        let was_active = *self.sequence_active.read().await;
        *self.sequence_active.write().await = true;
        let count = items.len();
        self.set_all_images(items).await;
        if !self.images.read().await.is_empty() && matches!(*self.state.read().await, SlideshowState::Stopped) {
            *self.state.write().await = SlideshowState::Playing;
        }
        // A scene on screen may have been edited
        if let Err(e) = self.apply_current_clip().await {
            eprintln!("Failed to apply current clip: {}", e);
        }
        if !was_active {
            println!("🎞️ Playing sequence \"{}\" ({} clips)", sequence_name, count);
        }
        Ok(true)
    }

    pub async fn has_overlay_layers(&self) -> bool {
        self.layer_manager.read().await.has_overlay_layers().await
    }

    pub async fn set_transition_frame(&self, frame: Option<image::RgbaImage>) {
        self.layer_manager.write().await.set_transition_frame(frame).await
    }

    pub async fn render_overlay_layers(&self) -> Result<image::RgbaImage, String> {
        self.layer_manager.read().await.render_overlay_layers().await
    }

    /// Add static overlay layer (for future HTTP API)
    #[allow(dead_code)]
    pub async fn add_overlay_layer(&self, id: String, image_path: String, x: u32, y: u32, width: u32, height: u32, opacity: f32) -> Result<(), String> {
        let overlay_layer = Layer::new(id, LayerType::StaticOverlay)
            .with_image(image_path)
            .with_position(x, y, width, height)
            .with_opacity(opacity)
            .with_name("Static Overlay".to_string());

        self.add_layer(overlay_layer).await
    }

    /// Clear layer cache (for future HTTP API)
    #[allow(dead_code)]
    pub async fn clear_layer_cache(&self) {
        self.layer_manager.write().await.clear_cache().await;
    }

    /// Get cache statistics (for future HTTP API)
    #[allow(dead_code)]
    pub async fn get_layer_cache_stats(&self) -> (usize, usize) {
        self.layer_manager.read().await.get_cache_stats().await
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    fn playlist(ids: &[&str]) -> Vec<ImageInfo> {
        ids.iter()
            .enumerate()
            .map(|(order, id)| ImageInfo {
                id: id.to_string(),
                path: format!("{}.png", id),
                order: order as u32,
                url: None,
                extension: Some(".png".to_string()),
                ..Default::default()
            })
            .collect()
    }

    #[test]
    fn server_layer_converts_to_data_row() {
        let doc = serde_json::json!({
            "layer_id": "layer_1", "name": "Header", "layer_type": "StaticOverlay",
            "content": { "text": "Hello", "backgroundColor": "rgba(30, 58, 138, 200)",
                         "textColor": "rgba(255, 255, 255, 1)", "fontSize": 36, "alignment": "center",
                         "verticalAlignment": "bottom" },
            "position": { "x": 0, "y": 990, "width": 1920, "height": 90 },
            "visible": false, "opacity": 0.5, "priority": 300
        });
        let layer = SlideshowController::server_layer_to_layer(&doc, Path::new("/img")).unwrap();
        assert_eq!(layer.id, "layer_1");
        assert_eq!(layer.layer_type, LayerType::DataRow);
        assert_eq!((layer.position.y, layer.position.height), (990, 90));
        assert_eq!(layer.priority, 255);
        assert!(!layer.visible);
        match layer.content {
            LayerContent::DataRow { text, background_color, text_color, font_size, vertical_alignment, .. } => {
                assert_eq!(text, "Hello");
                assert_eq!(vertical_alignment, "bottom");
                assert_eq!(background_color, (30, 58, 138, 200)); // 0-255 alpha kept as is
                assert_eq!(text_color, (255, 255, 255, 255));     // CSS 0-1 alpha scaled
                assert_eq!(font_size, 36);
            }
            other => panic!("unexpected content {:?}", other),
        }
    }

    #[test]
    fn server_layer_without_id_is_skipped() {
        assert!(SlideshowController::server_layer_to_layer(&serde_json::json!({ "name": "x" }), Path::new("/img")).is_none());
    }

    #[test]
    fn server_layer_with_image_draws_the_image() {
        let doc = serde_json::json!({
            "layer_id": "layer_seal", "name": "Court Seal",
            "content": { "text": "", "image_id": "image_abc", "backgroundColor": "rgba(0, 0, 0, 0)" },
            "position": { "x": 1632, "y": 918, "width": 288, "height": 162 }
        });
        let layer = SlideshowController::server_layer_to_layer(&doc, Path::new("/img")).unwrap();
        match layer.content {
            LayerContent::ImagePath(path) => assert_eq!(path, "/img/image_abc.layerimg"),
            other => panic!("unexpected content {:?}", other),
        }
    }

    #[test]
    fn scheduled_images_drops_inactive_ones() {
        use crate::image_schedule::ImageSchedule;
        let mut images = playlist(&["always", "expired", "weekend"]);
        images[1].schedule = Some(ImageSchedule { end_time: Some("2026-01-01T00:00:00Z".into()), ..Default::default() });
        images[2].schedule = Some(ImageSchedule { days_of_week: vec![0, 6], ..Default::default() });

        // Thursday
        let now = chrono::DateTime::parse_from_rfc3339("2026-10-22T12:00:00-06:00").unwrap();
        let ids: Vec<_> = SlideshowController::scheduled_images(&images, &now).into_iter().map(|img| img.id).collect();
        assert_eq!(ids, vec!["always"]);
    }

    #[test]
    fn restore_follows_image_when_playlist_reorders() {
        let mut index = 1;
        SlideshowController::restore_current_index(&playlist(&["c", "a", "b"]), &mut index, Some("b".into()));
        assert_eq!(index, 2);
    }

    #[test]
    fn restore_follows_the_clip_when_an_image_is_used_twice() {
        let clip = |clip_id: &str, image: &str| ImageInfo {
            id: image.into(),
            clip_id: Some(clip_id.into()),
            ..Default::default()
        };
        // Showing the second "logo" clip; a clip is added in front
        let before = vec![clip("c1", "logo"), clip("c2", "photo"), clip("c3", "logo")];
        let after = vec![clip("c0", "photo"), clip("c1", "logo"), clip("c2", "photo"), clip("c3", "logo")];
        let mut index = 2;
        let previous = SlideshowController::current_image_id(&before, index);
        SlideshowController::restore_current_index(&after, &mut index, previous);
        assert_eq!(index, 3);
    }

    #[test]
    fn scene_clips_report_no_image() {
        let scene = ImageInfo { id: "scene_1".into(), scene_id: Some("scene_1".into()), clip_id: Some("c".into()), ..Default::default() };
        let image = ImageInfo { id: "image_1".into(), ..Default::default() };
        assert_eq!(scene.image_id(), None);
        assert_eq!(scene.key(), "c");
        assert_eq!(image.image_id(), Some("image_1"));
        assert_eq!(image.key(), "image_1");
    }

    #[test]
    fn restore_clamps_when_image_was_removed() {
        let mut index = 3;
        SlideshowController::restore_current_index(&playlist(&["a", "b"]), &mut index, Some("gone".into()));
        assert_eq!(index, 0);
    }

    #[test]
    fn restore_keeps_index_when_still_in_range() {
        let mut index = 1;
        SlideshowController::restore_current_index(&playlist(&["a", "b", "c"]), &mut index, Some("gone".into()));
        assert_eq!(index, 1);
    }
}
