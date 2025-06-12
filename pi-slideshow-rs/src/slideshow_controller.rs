use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc, RwLock};
use crate::mqtt_client::{ImageInfo, MqttClient, SlideshowCommand, SlideshowConfig, TvStatus};
use crate::couchdb_client::CouchDbClient;

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
    pub tv_id: String,
    pub orientation: String,
    pub transition_effect: String,
}

pub struct SlideshowController {
    config: Arc<RwLock<ControllerConfig>>,
    state: Arc<RwLock<SlideshowState>>,
    pub current_index: Arc<RwLock<usize>>,
    images: Arc<RwLock<Vec<ImageInfo>>>,
    command_receiver: broadcast::Receiver<SlideshowCommand>,
    status_sender: mpsc::Sender<TvStatus>,
    mqtt_client: Arc<RwLock<Option<MqttClient>>>,
    couchdb_client: Arc<RwLock<Option<CouchDbClient>>>,
    pub start_time: Instant,
}

impl Clone for SlideshowController {
    fn clone(&self) -> Self {
        Self {
            config: self.config.clone(),
            state: self.state.clone(),
            current_index: self.current_index.clone(),
            images: self.images.clone(),
            command_receiver: self.command_receiver.resubscribe(),
            status_sender: self.status_sender.clone(),
            mqtt_client: self.mqtt_client.clone(),
            couchdb_client: self.couchdb_client.clone(),
            start_time: self.start_time,
        }
    }
}

impl SlideshowController {
    pub fn new(
        config: ControllerConfig,
        command_receiver: broadcast::Receiver<SlideshowCommand>,
        status_sender: mpsc::Sender<TvStatus>,
    ) -> Self {
        Self {
            config: Arc::new(RwLock::new(config)),
            state: Arc::new(RwLock::new(SlideshowState::Stopped)),
            current_index: Arc::new(RwLock::new(0)),
            images: Arc::new(RwLock::new(Vec::new())),
            command_receiver,
            status_sender,
            mqtt_client: Arc::new(RwLock::new(None)),
            couchdb_client: Arc::new(RwLock::new(None)),
            start_time: Instant::now(),
        }
    }

    pub async fn set_mqtt_client(&self, mqtt_client: MqttClient) {
        *self.mqtt_client.write().await = Some(mqtt_client);
    }

    pub async fn set_couchdb_client(&self, couchdb_client: CouchDbClient) {
        *self.couchdb_client.write().await = Some(couchdb_client);
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
            }
        }
        
        // Fetch images from CouchDB
        if let Err(e) = self.fetch_images_from_couchdb().await {
            eprintln!("Warning: Failed to fetch images from CouchDB: {}", e);
            println!("Continuing with local images only");
        }

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
        let mut images = self.images.write().await;
        images.clear();

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
        Ok(())
    }

    async fn fetch_images_from_couchdb(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let config = self.config.read().await;
        let tv_id = format!("tv_{}", config.tv_id);
        
        if let Some(ref couchdb_client) = *self.couchdb_client.read().await {
            let couchdb_images = couchdb_client.get_images_for_tv(&tv_id).await?;
            
            // Always clear local images when CouchDB is available - we only show what's assigned
            let mut local_images = self.images.write().await;
            local_images.clear();
            
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

                    let updated_info = ImageInfo {
                        id: image_info.id,
                        path: local_path.to_string_lossy().to_string(),
                        order: image_info.order,
                        url: None, // Not needed for CouchDB attachments
                        extension: image_info.extension,
                    };
                    
                    local_images.push(updated_info);
                }

                local_images.sort_by(|a, b| a.order.cmp(&b.order));
                println!("Updated to {} images from CouchDB", local_images.len());
            } else {
                println!("No images assigned to {} in CouchDB", tv_id);
            }
            
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
            }
            SlideshowCommand::Previous => {
                self.advance_to_previous_image().await;
            }
            SlideshowCommand::UpdateImages { images } => {
                self.update_images(images).await?;
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

    async fn update_images(&self, new_images: Vec<ImageInfo>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let config = self.config.read().await;
        let mut images = self.images.write().await;
        
        println!("Updating images: received {} new images (previous count: {})", new_images.len(), images.len());

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
            
            let updated_info = ImageInfo {
                id: image_info.id,
                path: local_path.to_string_lossy().to_string(),
                order: image_info.order,
                url: None, // Not needed for CouchDB attachments
                extension: image_info.extension,
            };
            updated_images.push(updated_info);
        }
        
        *images = updated_images;
        images.sort_by(|a, b| a.order.cmp(&b.order));

        // Reset current index if out of bounds
        let mut current_index = self.current_index.write().await;
        if *current_index >= images.len() && !images.is_empty() {
            *current_index = 0;
        }

        // Update state based on image availability
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
        
        let current_image = images.get(current_index).map(|img| img.id.clone());
        let status_str = match *state {
            SlideshowState::Playing => "playing".to_string(),
            SlideshowState::Paused => "paused".to_string(),
            SlideshowState::Stopped => "stopped".to_string(),
        };
        
        let status = TvStatus {
            status: status_str.clone(),
            current_image: current_image.clone(),
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
            if let Err(e) = couchdb_client.update_tv_status(&tv_id, &status_str, current_image.as_deref()).await {
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

        let config = self.config.read().await;
        last_change.elapsed() >= config.display_duration
    }


    pub async fn publish_current_image_to_mqtt(&self) {
        if let Some(ref mqtt_client) = *self.mqtt_client.read().await {
            let current_index = *self.current_index.read().await;
            let images = self.images.read().await;
            
            if let Some(current_image) = images.get(current_index) {
                if let Err(e) = mqtt_client.publish_current_image(&current_image.id).await {
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
                }
            }
            
            // Periodically sync with CouchDB
            if let Err(e) = self.fetch_images_from_couchdb().await {
                eprintln!("Failed to sync with CouchDB: {}", e);
            }
            
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
}