use rumqttc::{AsyncClient, Event, Incoming, MqttOptions, QoS};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{broadcast, mpsc};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MqttCommand {
    pub command: String,
    pub payload: serde_json::Value,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TvStatus {
    pub status: String,
    pub current_image: Option<String>,
    pub total_images: usize,
    pub current_index: usize,
    pub uptime: u64,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatMessage {
    pub tv_id: String,
    pub timestamp: String,
    pub status: String,
}

#[derive(Debug, Clone)]
pub enum SlideshowCommand {
    Play,
    Pause,
    Next,
    Previous,
    UpdateImages { images: Vec<ImageInfo> },
    UpdateConfig { config: SlideshowConfig },
    Reboot,
    Shutdown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageInfo {
    pub id: String,
    pub path: String,
    pub order: u32,
    pub url: Option<String>, // URL to download image from management server
    pub extension: Option<String>, // File extension from server
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlideshowConfig {
    pub transition_effect: Option<String>,
    pub display_duration: Option<u64>,
    pub transition_duration: Option<u64>,
}

#[derive(Clone)]
pub struct MqttClient {
    client: AsyncClient,
    tv_id: String,
    command_sender: broadcast::Sender<SlideshowCommand>,
    status_receiver: Arc<tokio::sync::Mutex<mpsc::Receiver<TvStatus>>>,
}

impl MqttClient {
    pub async fn new(
        broker_url: &str,
        tv_id: String,
        command_sender: broadcast::Sender<SlideshowCommand>,
        status_receiver: mpsc::Receiver<TvStatus>,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        // Parse the broker URL to extract hostname and port
        let (hostname, port) = if broker_url.starts_with("mqtt://") {
            let url_without_scheme = &broker_url[7..]; // Remove "mqtt://"
            if let Some(colon_pos) = url_without_scheme.rfind(':') {
                let host = &url_without_scheme[..colon_pos];
                let port_str = &url_without_scheme[colon_pos + 1..];
                let port = port_str.parse::<u16>().unwrap_or(1883);
                (host.to_string(), port)
            } else {
                (url_without_scheme.to_string(), 1883)
            }
        } else {
            // Assume it's just a hostname/IP
            (broker_url.to_string(), 1883)
        };

        let mut mqttoptions = MqttOptions::new(&tv_id, &hostname, port);
        mqttoptions.set_keep_alive(Duration::from_secs(60));
        mqttoptions.set_clean_session(true);

        let (client, mut eventloop) = AsyncClient::new(mqttoptions, 10);
        
        // Subscribe to command topic
        let command_topic = format!("signage/tv/{}/command", tv_id);
        client.subscribe(&command_topic, QoS::AtLeastOnce).await?;
        
        println!("MQTT client connected, subscribed to {}", command_topic);

        let mqtt_client = Self {
            client,
            tv_id: tv_id.clone(),
            command_sender,
            status_receiver: Arc::new(tokio::sync::Mutex::new(status_receiver)),
        };

        // Spawn MQTT event loop handler
        let cmd_sender = mqtt_client.command_sender.clone();
        let tv_id_clone = tv_id.clone();
        tokio::spawn(async move {
            loop {
                match eventloop.poll().await {
                    Ok(Event::Incoming(Incoming::Publish(publish))) => {
                        if let Err(e) = Self::handle_mqtt_message(&publish.topic, &publish.payload, &cmd_sender, &tv_id_clone).await {
                            eprintln!("Error handling MQTT message: {}", e);
                        }
                    }
                    Ok(_) => {}
                    Err(e) => {
                        eprintln!("MQTT connection error: {}", e);
                        tokio::time::sleep(Duration::from_secs(5)).await;
                    }
                }
            }
        });

        Ok(mqtt_client)
    }

    async fn handle_mqtt_message(
        topic: &str,
        payload: &[u8],
        command_sender: &broadcast::Sender<SlideshowCommand>,
        tv_id: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let expected_topic = format!("signage/tv/{}/command", tv_id);
        if topic != expected_topic {
            return Ok(());
        }

        let payload_str = String::from_utf8(payload.to_vec())?;
        let mqtt_command: MqttCommand = serde_json::from_str(&payload_str)?;

        println!("Received MQTT command: {}", mqtt_command.command);

        let slideshow_command = match mqtt_command.command.as_str() {
            "play" => SlideshowCommand::Play,
            "pause" => SlideshowCommand::Pause,
            "next" => SlideshowCommand::Next,
            "previous" => SlideshowCommand::Previous,
            "reboot" => SlideshowCommand::Reboot,
            "shutdown" => SlideshowCommand::Shutdown,
            "update_images" => {
                let images: Vec<ImageInfo> = serde_json::from_value(mqtt_command.payload["images"].clone())?;
                SlideshowCommand::UpdateImages { images }
            },
            "update_config" => {
                let config: SlideshowConfig = serde_json::from_value(mqtt_command.payload.clone())?;
                SlideshowCommand::UpdateConfig { config }
            },
            _ => {
                println!("Unknown command: {}", mqtt_command.command);
                return Ok(());
            }
        };

        if let Err(e) = command_sender.send(slideshow_command) {
            eprintln!("Error sending command to slideshow: {}", e);
        }

        Ok(())
    }

    pub async fn publish_status(&self, status: &TvStatus) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let topic = format!("signage/tv/{}/status", self.tv_id);
        let payload = serde_json::to_string(status)?;
        
        self.client.publish(&topic, QoS::AtLeastOnce, false, payload).await?;
        Ok(())
    }


    pub async fn publish_current_image(&self, image_id: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let topic = format!("signage/tv/{}/image/current", self.tv_id);
        let payload = serde_json::json!({
            "image_id": image_id,
            "timestamp": chrono::Utc::now().to_rfc3339()
        });
        
        self.client.publish(&topic, QoS::AtLeastOnce, false, payload.to_string()).await?;
        Ok(())
    }

    pub async fn publish_error(&self, error: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let topic = format!("signage/tv/{}/error", self.tv_id);
        let payload = serde_json::json!({
            "error": error,
            "timestamp": chrono::Utc::now().to_rfc3339()
        });
        
        self.client.publish(&topic, QoS::AtLeastOnce, false, payload.to_string()).await?;
        Ok(())
    }

    pub async fn run_status_publisher(&mut self) {
        let client = self.client.clone();
        let tv_id = self.tv_id.clone();
        let status_receiver = self.status_receiver.clone();
        
        // Start heartbeat task
        let heartbeat_client = client.clone();
        let heartbeat_tv_id = tv_id.clone();
        tokio::spawn(async move {
            let mut heartbeat_interval = tokio::time::interval(Duration::from_secs(30));
            
            loop {
                heartbeat_interval.tick().await;
                
                let heartbeat = HeartbeatMessage {
                    tv_id: heartbeat_tv_id.clone(),
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    status: "online".to_string(),
                };
                
                if let Ok(payload) = serde_json::to_string(&heartbeat) {
                    let topic = format!("signage/tv/{}/heartbeat", heartbeat_tv_id);
                    if let Err(e) = heartbeat_client.publish(&topic, QoS::AtLeastOnce, false, payload).await {
                        eprintln!("Failed to publish heartbeat: {}", e);
                    }
                }
            }
        });
        
        // Start status update task
        tokio::spawn(async move {
            let mut receiver = status_receiver.lock().await;
            
            while let Some(status) = receiver.recv().await {
                if let Ok(payload) = serde_json::to_string(&status) {
                    let topic = format!("signage/tv/{}/status", tv_id);
                    if let Err(e) = client.publish(&topic, QoS::AtLeastOnce, false, payload).await {
                        eprintln!("Failed to publish status update: {}", e);
                    }
                }
            }
        });
    }
}

// Helper function to generate unique TV ID based on hostname or MAC address
pub async fn generate_tv_id() -> String {
    // Try to get hostname first
    if let Ok(hostname) = std::process::Command::new("hostname").output() {
        if let Ok(hostname_str) = String::from_utf8(hostname.stdout) {
            let clean_hostname = hostname_str.trim().replace(' ', "_");
            if !clean_hostname.is_empty() && clean_hostname != "localhost" {
                return format!("tv_{}", clean_hostname);
            }
        }
    }

    // Fallback to UUID
    format!("tv_{}", Uuid::new_v4().to_string()[..8].to_string())
}

