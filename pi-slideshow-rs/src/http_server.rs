use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::sync::Arc;
use tokio::sync::broadcast;
use warp::{reply, Filter, Rejection};

use crate::mqtt_client::SlideshowCommand;
use crate::slideshow_controller::SlideshowController;

#[derive(Debug)]
struct ControlError(#[allow(dead_code)] String);
impl warp::reject::Reject for ControlError {}

#[derive(Debug)]
struct ConfigError(#[allow(dead_code)] String);
impl warp::reject::Reject for ConfigError {}

#[derive(Debug, Deserialize, Serialize)]
struct ApiResponse<T> {
    success: bool,
    data: Option<T>,
    message: String,
}

#[derive(Debug, Deserialize)]
struct ControlRequest {
    action: String,
}

#[derive(Debug, Deserialize)]
struct ConfigRequest {
    display_duration: Option<u64>,
    transition_duration: Option<u64>,
    transition_effect: Option<String>,
}

impl<T> ApiResponse<T> {
    fn success(data: T, message: &str) -> Self {
        Self {
            success: true,
            data: Some(data),
            message: message.to_string(),
        }
    }

}

pub async fn run_http_server(
    port: u16,
    controller: SlideshowController,
    command_sender: broadcast::Sender<SlideshowCommand>,
) {
    let controller = Arc::new(controller);
    let command_sender = Arc::new(command_sender);

    // Health check endpoint
    let health = warp::path("health")
        .and(warp::get())
        .map(|| {
            reply::json(&ApiResponse::success("healthy", "TV endpoint is running"))
        });

    // Version endpoint
    let version = warp::path("version")
        .and(warp::get())
        .map(|| {
            let version_info = serde_json::json!({
                "version": env!("CARGO_PKG_VERSION"),
                "commit_hash": env!("GIT_COMMIT_HASH"),
                "commit_short": env!("GIT_COMMIT_SHORT"),
                "branch": env!("GIT_BRANCH"),
                "build_time": env!("BUILD_TIME")
            });
            reply::json(&ApiResponse::success(version_info, "Version information"))
        });

    // Status endpoint
    let status_controller = controller.clone();
    let status = warp::path("status")
        .and(warp::get())
        .and_then(move || {
            let controller = status_controller.clone();
            async move {
                let status = get_tv_status(&controller).await;
                Ok::<_, Infallible>(reply::json(&ApiResponse::success(status, "Status retrieved")))
            }
        });

    // Control endpoint
    let control_sender = command_sender.clone();
    let control = warp::path("control")
        .and(warp::post())
        .and(warp::body::json::<ControlRequest>())
        .and_then(move |req: ControlRequest| {
            let sender = control_sender.clone();
            async move {
                match handle_control_request(req, &sender).await {
                    Ok(msg) => Ok::<_, Rejection>(warp::reply::json(&ApiResponse::success((), &msg))),
                    Err(e) => Err(warp::reject::custom(ControlError(e))),
                }
            }
        });

    // Config endpoint
    let config_sender = command_sender.clone();
    let config = warp::path("config")
        .and(warp::put())
        .and(warp::body::json::<ConfigRequest>())
        .and_then(move |req: ConfigRequest| {
            let sender = config_sender.clone();
            async move {
                match handle_config_request(req, &sender).await {
                    Ok(msg) => Ok::<_, Rejection>(warp::reply::json(&ApiResponse::success((), &msg))),
                    Err(e) => Err(warp::reject::custom(ConfigError(e))),
                }
            }
        });

    // Images endpoint
    let images_controller = controller.clone();
    let images = warp::path("images")
        .and(warp::get())
        .and_then(move || {
            let controller = images_controller.clone();
            async move {
                let images = get_image_list(&controller).await;
                Ok::<_, Infallible>(reply::json(&ApiResponse::success(images, "Images retrieved")))
            }
        });

    // Combine all routes
    let api = warp::path("api")
        .and(health.or(version).or(status).or(control).or(config).or(images))
        .with(warp::cors().allow_any_origin().allow_headers(vec!["content-type"]).allow_methods(vec!["GET", "POST", "PUT"]));

    // Root endpoint
    let root = warp::path::end()
        .map(|| {
            reply::html(
                r#"
                <html>
                <head><title>TV Endpoint Control</title></head>
                <body>
                <h1>Digital Signage TV Endpoint</h1>
                <p>API endpoints:</p>
                <ul>
                <li>GET /api/health - Health check</li>
                <li>GET /api/version - Version information</li>
                <li>GET /api/status - Get TV status</li>
                <li>POST /api/control - Control slideshow (play, pause, next, previous)</li>
                <li>PUT /api/config - Update configuration</li>
                <li>GET /api/images - Get image list</li>
                </ul>
                </body>
                </html>
                "#
            )
        });

    let routes = root.or(api);

    println!("Starting HTTP server on port {}", port);
    warp::serve(routes)
        .run(([0, 0, 0, 0], port))
        .await;
}

async fn get_tv_status(controller: &SlideshowController) -> serde_json::Value {
    serde_json::json!({
        "state": format!("{:?}", controller.get_state().await),
        "image_count": controller.get_image_count().await,
        "current_image": controller.get_current_image_path().await
            .map(|p| p.to_string_lossy().to_string()),
        "uptime_seconds": controller.start_time.elapsed().as_secs(),
        "timestamp": chrono::Utc::now().to_rfc3339()
    })
}

async fn get_image_list(controller: &SlideshowController) -> serde_json::Value {
    let images = controller.get_image_list().await;
    let current_index = *controller.current_index.read().await;
    
    serde_json::json!({
        "count": images.len(),
        "current_index": current_index,
        "current_image": images.get(current_index).map(|img| &img.id),
        "images": images.iter().map(|img| serde_json::json!({
            "id": img.id,
            "path": img.path,
            "order": img.order,
            "extension": img.extension
        })).collect::<Vec<_>>()
    })
}

async fn handle_control_request(
    req: ControlRequest,
    command_sender: &broadcast::Sender<SlideshowCommand>,
) -> Result<String, String> {
    let command = match req.action.as_str() {
        "play" => SlideshowCommand::Play,
        "pause" => SlideshowCommand::Pause,
        "next" => SlideshowCommand::Next,
        "previous" => SlideshowCommand::Previous,
        "reboot" => SlideshowCommand::Reboot,
        "shutdown" => SlideshowCommand::Shutdown,
        _ => return Err(format!("Unknown action: {}", req.action)),
    };

    command_sender.send(command)
        .map_err(|e| format!("Failed to send command: {}", e))?;

    Ok(format!("Command '{}' sent successfully", req.action))
}

async fn handle_config_request(
    req: ConfigRequest,
    command_sender: &broadcast::Sender<SlideshowCommand>,
) -> Result<String, String> {
    let config = crate::mqtt_client::SlideshowConfig {
        display_duration: req.display_duration,
        transition_duration: req.transition_duration,
        transition_effect: req.transition_effect,
        orientation: None,
    };

    let command = SlideshowCommand::UpdateConfig { config };

    command_sender.send(command)
        .map_err(|e| format!("Failed to send config update: {}", e))?;

    Ok("Configuration updated successfully".to_string())
}