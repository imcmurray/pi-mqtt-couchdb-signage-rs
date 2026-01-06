use couch_rs::{Client, database::Database, document::TypedCouchDocument};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::borrow::Cow;
use crate::mqtt_client::ImageInfo;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CouchImage {
    #[serde(rename = "_id")]
    pub id: String,
    #[serde(rename = "_rev", skip_serializing_if = "Option::is_none")]
    pub rev: Option<String>,
    #[serde(rename = "type")]
    pub doc_type: String,
    pub original_name: String,
    pub size: u64,
    pub metadata: ImageMetadata,
    pub assigned_tvs: Vec<String>,
    #[serde(alias = "upload_date")]
    pub created_at: String,
    #[serde(rename = "_attachments", skip_serializing_if = "Option::is_none")]
    pub attachments: Option<HashMap<String, Attachment>>,
}



#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageMetadata {
    pub width: u32,
    pub height: u32,
    #[serde(default = "default_format")]
    pub format: String,
}

fn default_format() -> String {
    "png".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attachment {
    pub content_type: String,
    pub length: u64,
    pub digest: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CouchTv {
    #[serde(rename = "_id")]
    pub id: String,
    #[serde(rename = "_rev", skip_serializing_if = "Option::is_none")]
    pub rev: Option<String>,
    #[serde(rename = "type")]
    pub doc_type: String,
    pub name: String,
    pub location: String,
    pub ip_address: String,
    pub status: String,
    pub last_heartbeat: Option<String>,
    pub config: TvConfig,
    pub current_image: Option<String>,
}


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TvConfig {
    pub transition_effect: String,
    pub display_duration: u64,
    #[serde(default = "default_orientation")]
    pub orientation: String,
    #[serde(default)]
    pub layers: std::collections::HashMap<String, CouchLayer>,
    #[serde(default)]
    pub layer_settings: CouchLayerSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CouchLayer {
    pub enabled: bool,
    #[serde(default)]
    pub image_path: Option<String>,
    #[serde(default)]
    pub position: CouchPosition,
    #[serde(default = "default_opacity")]
    pub opacity: f32,
    #[serde(default = "default_priority")]
    pub priority: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CouchPosition {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl Default for CouchPosition {
    fn default() -> Self {
        Self { x: 0, y: 0, width: 0, height: 0 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CouchLayerSettings {
    #[serde(default = "default_max_layers")]
    pub max_layers: u8,
    #[serde(default = "default_compositing_timeout")]
    pub compositing_timeout_ms: u32,
    #[serde(default = "default_cache_composites")]
    pub cache_composites: bool,
}

impl Default for CouchLayerSettings {
    fn default() -> Self {
        Self {
            max_layers: default_max_layers(),
            compositing_timeout_ms: default_compositing_timeout(),
            cache_composites: default_cache_composites(),
        }
    }
}

fn default_orientation() -> String {
    "landscape".to_string()
}

fn default_opacity() -> f32 {
    1.0
}

fn default_priority() -> u8 {
    1
}

fn default_max_layers() -> u8 {
    10
}

fn default_compositing_timeout() -> u32 {
    5000
}

fn default_cache_composites() -> bool {
    true
}

fn create_default_tv_config() -> TvConfig {
    
    let mut layers = std::collections::HashMap::new();
    
    // Create default slideshow layer
    layers.insert("slideshow".to_string(), CouchLayer {
        enabled: true,
        image_path: None,
        position: CouchPosition { x: 0, y: 0, width: 1920, height: 1080 },
        opacity: 1.0,
        priority: 1,
    });
    
    TvConfig {
        transition_effect: "fade".to_string(),
        display_duration: 5000,
        orientation: "landscape".to_string(),
        layers,
        layer_settings: CouchLayerSettings::default(),
    }
}

impl TypedCouchDocument for CouchTv {
    fn get_id(&self) -> Cow<str> {
        Cow::Borrowed(&self.id)
    }

    fn get_rev(&self) -> Cow<str> {
        Cow::Borrowed(self.rev.as_deref().unwrap_or(""))
    }

    fn set_id(&mut self, id: &str) {
        self.id = id.to_string();
    }

    fn set_rev(&mut self, rev: &str) {
        self.rev = Some(rev.to_string());
    }

    fn merge_ids(&mut self, other: &Self) {
        self.id = other.id.clone();
        self.rev = other.rev.clone();
    }
}

pub struct CouchDbClient {
    tv_db: Database,
    images_db: Database,
    server_url: String,
    tv_database_name: String,
    images_database_name: String,
    username: Option<String>,
    password: Option<String>,
}

impl CouchDbClient {
    pub async fn new(
        couchdb_url: &str,
        username: Option<&str>,
        password: Option<&str>,
        tv_database: &str,
        images_database: &str,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let client = if let (Some(user), Some(pass)) = (username, password) {
            Client::new(&couchdb_url, user, pass).map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?
        } else {
            Client::new_no_auth(&couchdb_url).map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?
        };

        // Connect to the TV database (for TV documents)
        let tv_db = client.db(tv_database).await.map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;

        // Connect to the images database (for image documents)
        let images_db = client.db(images_database).await.map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;

        Ok(CouchDbClient {
            tv_db,
            images_db,
            server_url: couchdb_url.to_string(),
            tv_database_name: tv_database.to_string(),
            images_database_name: images_database.to_string(),
            username: username.map(|s| s.to_string()),
            password: password.map(|s| s.to_string()),
        })
    }

    pub async fn get_images_for_tv(&self, tv_id: &str) -> Result<Vec<ImageInfo>, Box<dyn std::error::Error + Send + Sync>> {
        println!("Fetching images for TV: {}", tv_id);
        
        // Get all documents and filter for images assigned to this TV with timeout
        let all_docs = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            self.images_db.get_all::<serde_json::Value>()
        ).await
            .map_err(|_| "CouchDB get_all query timeout after 30 seconds")?
            .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
        
        let mut images_for_tv = Vec::new();
        
        for doc in all_docs.rows {
            // Parse as CouchImage directly
            if let Ok(image_doc) = serde_json::from_value::<CouchImage>(doc) {
                // Check if this is an image document and if this TV is in the assigned_tvs list
                if image_doc.doc_type == "image" && image_doc.assigned_tvs.contains(&tv_id.to_string()) {
                    // Determine file extension from attachment content_type, fallback to metadata format, then original name
                    let extension = if let Some(attachments) = &image_doc.attachments {
                        if let Some((_name, attachment)) = attachments.iter().next() {
                            // Use content_type to determine extension
                            match attachment.content_type.as_str() {
                                "image/jpeg" => ".jpg".to_string(),
                                "image/jpg" => ".jpg".to_string(),
                                "image/png" => ".png".to_string(),
                                "image/gif" => ".gif".to_string(),
                                "image/webp" => ".webp".to_string(),
                                _ => {
                                    // Fallback to metadata format if content_type is unknown
                                    if !image_doc.metadata.format.is_empty() {
                                        format!(".{}", image_doc.metadata.format.to_lowercase())
                                    } else {
                                        std::path::Path::new(&image_doc.original_name)
                                            .extension()
                                            .and_then(|ext| ext.to_str())
                                            .map(|ext| format!(".{}", ext))
                                            .unwrap_or_else(|| ".png".to_string())
                                    }
                                }
                            }
                        } else {
                            // No attachments, fallback to metadata
                            if !image_doc.metadata.format.is_empty() {
                                format!(".{}", image_doc.metadata.format.to_lowercase())
                            } else {
                                std::path::Path::new(&image_doc.original_name)
                                    .extension()
                                    .and_then(|ext| ext.to_str())
                                    .map(|ext| format!(".{}", ext))
                                    .unwrap_or_else(|| ".png".to_string())
                            }
                        }
                    } else {
                        // No attachments, fallback to metadata format, then original name
                        if !image_doc.metadata.format.is_empty() {
                            format!(".{}", image_doc.metadata.format.to_lowercase())
                        } else {
                            std::path::Path::new(&image_doc.original_name)
                                .extension()
                                .and_then(|ext| ext.to_str())
                                .map(|ext| format!(".{}", ext))
                                .unwrap_or_else(|| ".png".to_string())
                        }
                    };
                    
                    let image_info = ImageInfo {
                        id: image_doc.id.clone(),
                        path: format!("{}{}", image_doc.id, extension),
                        order: images_for_tv.len() as u32, // Use index as order for now
                        url: None, // Not needed for CouchDB attachments
                        extension: Some(extension),
                    };
                    
                    images_for_tv.push(image_info);
                }
            }
        }
        
        // Sort by order (which is currently just the index)
        images_for_tv.sort_by(|a, b| a.order.cmp(&b.order));
        
        println!("Found {} images for TV {}", images_for_tv.len(), tv_id);
        Ok(images_for_tv)
    }

    pub async fn download_image_attachment(&self, image_id: &str, local_path: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        println!("Downloading image attachment {} to {}", image_id, local_path);
        
        // First get the image document to find attachment info with timeout
        let doc_value: serde_json::Value = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            self.images_db.get(image_id)
        ).await
            .map_err(|_| format!("Timeout getting image document {} after 10 seconds", image_id))?
            .map_err(|e| format!("Failed to get image document {}: {}", image_id, e))?;
        
        let image_doc: CouchImage = serde_json::from_value(doc_value)
            .map_err(|e| format!("Failed to parse image document {}: {}", image_id, e))?;
        
        // Find the first attachment (usually the image file)
        if let Some(attachments) = &image_doc.attachments {
            if let Some((attachment_name, _attachment_info)) = attachments.iter().next() {
                println!("Found attachment: {}", attachment_name);
                
                // Construct the attachment URL manually since couch_rs doesn't have direct attachment download
                let db_url = format!("{}/{}/{}/{}",
                    self.get_server_url(),
                    self.images_database_name,
                    image_id,
                    attachment_name);
                
                println!("Downloading attachment from URL: {}", db_url);

                // Use reqwest to download the attachment with auth
                let client = reqwest::Client::new();
                let mut request = client.get(&db_url);

                if let (Some(user), Some(pass)) = (&self.username, &self.password) {
                    request = request.basic_auth(user, Some(pass));
                }

                let response = request.send().await
                    .map_err(|e| format!("Failed to download attachment: {}", e))?;
                
                if !response.status().is_success() {
                    return Err(format!("HTTP error downloading attachment: {}", response.status()).into());
                }
                
                let bytes = response.bytes().await
                    .map_err(|e| format!("Failed to read attachment bytes: {}", e))?;
                
                // Write to local file with the correct extension
                std::fs::write(local_path, bytes)
                    .map_err(|e| format!("Failed to write attachment to {}: {}", local_path, e))?;
                
                println!("Successfully downloaded attachment {} to {}", attachment_name, local_path);
                Ok(())
            } else {
                Err(format!("No attachments found for image {}", image_id).into())
            }
        } else {
            Err(format!("No attachments found for image {}", image_id).into())
        }
    }

    pub async fn update_tv_status(&self, tv_id: &str, status: &str, current_image: Option<&str>, ip_address: Option<&str>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        println!("Updating TV {} status to {} in CouchDB", tv_id, status);

        // Try to get existing TV document with timeout
        let tv_doc_result = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            self.tv_db.get::<serde_json::Value>(tv_id)
        ).await;

        let mut tv_doc = match tv_doc_result {
            Ok(Ok(doc)) => {
                // Parse existing document
                serde_json::from_value::<CouchTv>(doc)
                    .map_err(|e| format!("Failed to parse existing TV document {}: {}", tv_id, e))?
            }
            Ok(Err(_)) | Err(_) => {
                // Create new TV document if it doesn't exist
                println!("TV document {} not found, creating new one", tv_id);
                CouchTv {
                    id: tv_id.to_string(),
                    rev: None,
                    doc_type: "tv".to_string(),
                    name: format!("TV {}", tv_id),
                    location: "Unknown".to_string(),
                    ip_address: ip_address.unwrap_or("0.0.0.0").to_string(),
                    status: status.to_string(),
                    last_heartbeat: Some(chrono::Utc::now().to_rfc3339()),
                    config: create_default_tv_config(),
                    current_image: current_image.map(|s| s.to_string()),
                }
            }
        };

        // Update the status, current image, and IP address
        tv_doc.status = status.to_string();
        tv_doc.last_heartbeat = Some(chrono::Utc::now().to_rfc3339());
        if let Some(image) = current_image {
            tv_doc.current_image = Some(image.to_string());
        }
        if let Some(ip) = ip_address {
            tv_doc.ip_address = ip.to_string();
        }
        
        // Save the document back to CouchDB with timeout
        tokio::time::timeout(
            std::time::Duration::from_secs(10),
            self.tv_db.save(&mut tv_doc)
        ).await
            .map_err(|_| format!("Timeout saving TV document {} after 10 seconds", tv_id))?
            .map_err(|e| format!("Failed to save TV document {}: {}", tv_id, e))?;
        
        println!("Successfully updated TV {} status to {}", tv_id, status);
        Ok(())
    }

    pub async fn get_tv_config(&self, tv_id: &str) -> Result<Option<TvConfig>, Box<dyn std::error::Error + Send + Sync>> {
        println!("Getting TV config for {} from CouchDB", tv_id);
        
        // Try to get TV document from CouchDB with timeout
        match tokio::time::timeout(
            std::time::Duration::from_secs(10),
            self.tv_db.get::<serde_json::Value>(tv_id)
        ).await {
            Ok(Ok(doc_value)) => {
                // Parse the TV document
                match serde_json::from_value::<CouchTv>(doc_value) {
                    Ok(tv_doc) => {
                        println!("Retrieved config for TV {}: transition_effect={}, display_duration={}", 
                                tv_id, tv_doc.config.transition_effect, tv_doc.config.display_duration);
                        Ok(Some(tv_doc.config))
                    }
                    Err(e) => {
                        eprintln!("Failed to parse TV document {}: {}", tv_id, e);
                        // Return default config if parsing fails
                        Ok(Some(create_default_tv_config()))
                    }
                }
            }
            Ok(Err(e)) => {
                println!("TV document {} not found in CouchDB: {}, using default config", tv_id, e);
                // Return default config if document doesn't exist
                Ok(Some(create_default_tv_config()))
            }
            Err(_) => {
                println!("TV document {} query timeout, using default config", tv_id);
                // Return default config on timeout
                Ok(Some(create_default_tv_config()))
            }
        }
    }

    fn get_server_url(&self) -> &str {
        &self.server_url
    }

    /// Convert CouchDB TV config to LayerManager config
    pub fn convert_to_layer_config(&self, tv_config: &TvConfig, width: u32, height: u32) -> crate::layer_manager::LayerConfig {
        use crate::layer_manager::{LayerConfig, Layer, LayerType, Position, LayerContent};
        
        let mut layers = std::collections::HashMap::new();
        
        // Convert each CouchDB layer to LayerManager layer
        for (layer_id, couch_layer) in &tv_config.layers {
            let layer_type = match layer_id.as_str() {
                "slideshow" => LayerType::Slideshow,
                _ => LayerType::StaticOverlay,
            };
            
            let content = if let Some(image_path) = &couch_layer.image_path {
                LayerContent::ImagePath(image_path.clone())
            } else {
                LayerContent::Empty
            };
            
            let layer = Layer {
                id: layer_id.clone(),
                layer_type,
                position: Position {
                    x: couch_layer.position.x,
                    y: couch_layer.position.y,
                    width: couch_layer.position.width,
                    height: couch_layer.position.height,
                },
                target_position: None,
                opacity: couch_layer.opacity,
                priority: couch_layer.priority,
                visible: couch_layer.enabled,
                content,
                name: Some(layer_id.clone()),
                animation_state: None,
            };
            
            layers.insert(layer_id.clone(), layer);
        }
        
        LayerConfig {
            layers,
            output_resolution: (width, height),
            orientation: tv_config.orientation.clone(),
            max_layers: tv_config.layer_settings.max_layers,
            compositing_timeout_ms: tv_config.layer_settings.compositing_timeout_ms,
            cache_composites: tv_config.layer_settings.cache_composites,
        }
    }
}