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
}

fn default_orientation() -> String {
    "landscape".to_string()
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
    db: Database,
    server_url: String,
}

impl CouchDbClient {
    pub async fn new(couchdb_url: &str, username: Option<&str>, password: Option<&str>) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let client = if let (Some(user), Some(pass)) = (username, password) {
            Client::new(&couchdb_url, user, pass).map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?
        } else {
            Client::new_no_auth(&couchdb_url).map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?
        };

        // Connect to the single digital_signage database
        let db = client.db("digital_signage").await.map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;

        Ok(CouchDbClient {
            db,
            server_url: couchdb_url.to_string(),
        })
    }

    pub async fn get_images_for_tv(&self, tv_id: &str) -> Result<Vec<ImageInfo>, Box<dyn std::error::Error + Send + Sync>> {
        println!("Fetching images for TV: {}", tv_id);
        
        // Get all documents and filter for images assigned to this TV
        let all_docs = self.db.get_all::<serde_json::Value>().await
            .map_err(|e| Box::new(e) as Box<dyn std::error::Error + Send + Sync>)?;
        
        let mut images_for_tv = Vec::new();
        
        for doc in all_docs.rows {
            // Parse as CouchImage directly
            if let Ok(image_doc) = serde_json::from_value::<CouchImage>(doc) {
                // Check if this is an image document and if this TV is in the assigned_tvs list
                if image_doc.doc_type == "image" && image_doc.assigned_tvs.contains(&tv_id.to_string()) {
                    // Determine file extension from metadata format, fallback to original name, then default to png
                    let extension = if !image_doc.metadata.format.is_empty() {
                        format!(".{}", image_doc.metadata.format.to_lowercase())
                    } else {
                        std::path::Path::new(&image_doc.original_name)
                            .extension()
                            .and_then(|ext| ext.to_str())
                            .map(|ext| format!(".{}", ext))
                            .unwrap_or_else(|| ".png".to_string())
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
        
        // First get the image document to find attachment info
        let doc_value: serde_json::Value = self.db.get(image_id).await
            .map_err(|e| format!("Failed to get image document {}: {}", image_id, e))?;
        
        let image_doc: CouchImage = serde_json::from_value(doc_value)
            .map_err(|e| format!("Failed to parse image document {}: {}", image_id, e))?;
        
        // Find the first attachment (usually the image file)
        if let Some(attachments) = &image_doc.attachments {
            if let Some((attachment_name, _attachment_info)) = attachments.iter().next() {
                println!("Found attachment: {}", attachment_name);
                
                // Construct the attachment URL manually since couch_rs doesn't have direct attachment download
                let db_url = format!("{}/digital_signage/{}/{}", 
                    self.get_server_url(), 
                    image_id, 
                    attachment_name);
                
                println!("Downloading attachment from URL: {}", db_url);
                
                // Use reqwest to download the attachment
                let client = reqwest::Client::new();
                let response = client.get(&db_url).send().await
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

    pub async fn update_tv_status(&self, tv_id: &str, status: &str, current_image: Option<&str>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        println!("Updating TV {} status to {} in CouchDB", tv_id, status);
        
        // Try to get existing TV document
        let tv_doc_result = self.db.get::<serde_json::Value>(tv_id).await;
        
        let mut tv_doc = match tv_doc_result {
            Ok(doc) => {
                // Parse existing document
                serde_json::from_value::<CouchTv>(doc)
                    .map_err(|e| format!("Failed to parse existing TV document {}: {}", tv_id, e))?
            }
            Err(_) => {
                // Create new TV document if it doesn't exist
                println!("TV document {} not found, creating new one", tv_id);
                CouchTv {
                    id: tv_id.to_string(),
                    rev: None,
                    doc_type: "tv".to_string(),
                    name: format!("TV {}", tv_id),
                    location: "Unknown".to_string(),
                    ip_address: "0.0.0.0".to_string(), // Will be updated later
                    status: status.to_string(),
                    last_heartbeat: Some(chrono::Utc::now().to_rfc3339()),
                    config: TvConfig {
                        transition_effect: "fade".to_string(),
                        display_duration: 5000,
                        orientation: "landscape".to_string(),
                    },
                    current_image: current_image.map(|s| s.to_string()),
                }
            }
        };
        
        // Update the status and current image
        tv_doc.status = status.to_string();
        tv_doc.last_heartbeat = Some(chrono::Utc::now().to_rfc3339());
        if let Some(image) = current_image {
            tv_doc.current_image = Some(image.to_string());
        }
        
        // Save the document back to CouchDB
        self.db.save(&mut tv_doc).await
            .map_err(|e| format!("Failed to save TV document {}: {}", tv_id, e))?;
        
        println!("Successfully updated TV {} status to {}", tv_id, status);
        Ok(())
    }

    pub async fn get_tv_config(&self, tv_id: &str) -> Result<Option<TvConfig>, Box<dyn std::error::Error + Send + Sync>> {
        println!("Getting TV config for {} from CouchDB", tv_id);
        
        // Try to get TV document from CouchDB
        match self.db.get::<serde_json::Value>(tv_id).await {
            Ok(doc_value) => {
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
                        Ok(Some(TvConfig {
                            transition_effect: "fade".to_string(),
                            display_duration: 5000,
                            orientation: "landscape".to_string(),
                        }))
                    }
                }
            }
            Err(e) => {
                println!("TV document {} not found in CouchDB: {}, using default config", tv_id, e);
                // Return default config if document doesn't exist
                Ok(Some(TvConfig {
                    transition_effect: "fade".to_string(),
                    display_duration: 5000,
                    orientation: "landscape".to_string(),
                }))
            }
        }
    }

    fn get_server_url(&self) -> &str {
        &self.server_url
    }
}