use image::RgbaImage;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::Orientation;

/// Convert an RgbaImage to a BGRA buffer ready for framebuffer display
fn rgba_to_bgra_buffer(image: &RgbaImage) -> Vec<u8> {
    let width = image.width() as usize;
    let height = image.height() as usize;
    let mut buffer = vec![0u8; width * height * 4];

    for (i, pixel) in image.pixels().enumerate() {
        let offset = i * 4;
        buffer[offset] = pixel[2];     // B
        buffer[offset + 1] = pixel[1]; // G
        buffer[offset + 2] = pixel[0]; // R
        buffer[offset + 3] = pixel[3]; // A
    }

    buffer
}

/// Status of pre-computation
#[derive(Debug, Clone, PartialEq)]
pub enum PrecomputeStatus {
    Pending,
    InProgress {
        frames_completed: usize,
        total_frames: usize,
    },
    Ready,
    Invalidated,
}

/// Pre-computed transition frames between two images (stored as BGRA buffers for direct framebuffer display)
#[derive(Debug)]
pub struct PrecomputedTransition {
    pub from_image_id: String,
    pub to_image_id: String,
    pub transition_name: String,
    pub frames: Vec<Vec<u8>>,  // BGRA buffers ready for direct framebuffer display
    pub frame_count: usize,
    pub status: PrecomputeStatus,
    pub generated_at: Instant,
}

impl PrecomputedTransition {
    pub fn new(
        from_image_id: String,
        to_image_id: String,
        transition_name: String,
        frame_count: usize,
    ) -> Self {
        Self {
            from_image_id,
            to_image_id,
            transition_name,
            frames: Vec::with_capacity(frame_count),
            frame_count,
            status: PrecomputeStatus::Pending,
            generated_at: Instant::now(),
        }
    }
}

/// Manages pre-computed transitions with background computation
pub struct TransitionPrecomputer {
    current_precompute: Arc<RwLock<Option<PrecomputedTransition>>>,
    cancel_token: Arc<RwLock<bool>>,
    pub width: u32,
    pub height: u32,
    target_fps: u32,
}

impl TransitionPrecomputer {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            current_precompute: Arc::new(RwLock::new(None)),
            cancel_token: Arc::new(RwLock::new(false)),
            width,
            height,
            target_fps: 30,
        }
    }

    /// Get the current precomputation status
    pub async fn get_status(&self) -> Option<PrecomputeStatus> {
        self.current_precompute
            .read()
            .await
            .as_ref()
            .map(|p| p.status.clone())
    }

    /// Check if pre-computed transition is ready and valid for the given images
    pub async fn is_ready_for(
        &self,
        from_path: &PathBuf,
        to_path: &PathBuf,
        transition_name: &str,
    ) -> bool {
        let precompute = self.current_precompute.read().await;
        match &*precompute {
            Some(p) => {
                p.from_image_id == from_path.to_string_lossy()
                    && p.to_image_id == to_path.to_string_lossy()
                    && p.transition_name == transition_name
                    && p.status == PrecomputeStatus::Ready
            }
            None => false,
        }
    }

    /// Try to get pre-computed BGRA buffers if available and valid
    pub async fn try_get_frames(
        &self,
        from_path: &PathBuf,
        to_path: &PathBuf,
        transition_name: &str,
    ) -> Option<Vec<Vec<u8>>> {
        let precompute = self.current_precompute.read().await;
        match &*precompute {
            Some(p) => {
                if p.from_image_id == from_path.to_string_lossy()
                    && p.to_image_id == to_path.to_string_lossy()
                    && p.transition_name == transition_name
                    && p.status == PrecomputeStatus::Ready
                {
                    Some(p.frames.clone())
                } else {
                    None
                }
            }
            None => None,
        }
    }

    /// Get partial BGRA buffers if computation is in progress
    pub async fn try_get_partial_frames(
        &self,
        from_path: &PathBuf,
        to_path: &PathBuf,
        transition_name: &str,
    ) -> Option<(Vec<Vec<u8>>, usize)> {
        let precompute = self.current_precompute.read().await;
        match &*precompute {
            Some(p) => {
                if p.from_image_id == from_path.to_string_lossy()
                    && p.to_image_id == to_path.to_string_lossy()
                    && p.transition_name == transition_name
                {
                    match &p.status {
                        PrecomputeStatus::InProgress { .. } | PrecomputeStatus::Ready => {
                            if !p.frames.is_empty() {
                                Some((p.frames.clone(), p.frame_count))
                            } else {
                                None
                            }
                        }
                        _ => None,
                    }
                } else {
                    None
                }
            }
            None => None,
        }
    }

    /// Cancel any ongoing pre-computation and invalidate
    pub async fn invalidate(&self) {
        *self.cancel_token.write().await = true;

        let mut precompute = self.current_precompute.write().await;
        if let Some(ref mut p) = *precompute {
            p.status = PrecomputeStatus::Invalidated;
            p.frames.clear();
            p.frames.shrink_to_fit();
        }
    }

    /// Start pre-computing a transition in the background
    /// The frame_generator closure creates a single frame given (from_img, to_img, progress)
    pub async fn start_precompute<F>(
        &self,
        from_path: PathBuf,
        to_path: PathBuf,
        transition_name: String,
        transition_duration: Duration,
        orientation: Orientation,
        frame_generator: F,
    ) where
        F: Fn(&RgbaImage, &RgbaImage, f32) -> RgbaImage + Send + Sync + 'static,
    {
        // Cancel any existing precomputation
        *self.cancel_token.write().await = true;
        tokio::time::sleep(Duration::from_millis(10)).await;
        *self.cancel_token.write().await = false;

        // Calculate frame count
        let frame_count = (transition_duration.as_millis() / 33) as usize;
        let frame_count = frame_count.max(2); // At least 2 frames

        println!(
            "🔄 Starting pre-computation: {} frames for {} transition",
            frame_count, transition_name
        );

        // Initialize pre-computation state
        let precompute = PrecomputedTransition::new(
            from_path.to_string_lossy().to_string(),
            to_path.to_string_lossy().to_string(),
            transition_name.clone(),
            frame_count,
        );

        *self.current_precompute.write().await = Some(precompute);

        // Clone what we need for the background task
        let precompute_arc = self.current_precompute.clone();
        let cancel_token = self.cancel_token.clone();
        let width = self.width;
        let height = self.height;
        let frame_generator = Arc::new(frame_generator);

        // Spawn background task
        tokio::spawn(async move {
            Self::compute_frames_background(
                precompute_arc,
                cancel_token,
                from_path,
                to_path,
                transition_name,
                frame_count,
                width,
                height,
                orientation,
                frame_generator,
            )
            .await;
        });
    }

    async fn compute_frames_background<F>(
        precompute_arc: Arc<RwLock<Option<PrecomputedTransition>>>,
        cancel_token: Arc<RwLock<bool>>,
        from_path: PathBuf,
        to_path: PathBuf,
        transition_name: String,
        frame_count: usize,
        width: u32,
        height: u32,
        orientation: Orientation,
        frame_generator: Arc<F>,
    ) where
        F: Fn(&RgbaImage, &RgbaImage, f32) -> RgbaImage + Send + Sync + 'static,
    {
        let start_time = Instant::now();

        // Load source images (blocking IO wrapped in spawn_blocking)
        let from_img = match tokio::task::spawn_blocking({
            let path = from_path.clone();
            let orient = orientation.clone();
            move || crate::load_and_scale_image_with_orientation(&path, width, height, &orient)
        })
        .await
        {
            Ok(Ok(img)) => img,
            Ok(Err(e)) => {
                eprintln!("❌ Pre-compute: Failed to load from image: {}", e);
                Self::mark_invalidated(&precompute_arc).await;
                return;
            }
            Err(e) => {
                eprintln!("❌ Pre-compute: Task join error loading from image: {}", e);
                Self::mark_invalidated(&precompute_arc).await;
                return;
            }
        };

        let to_img = match tokio::task::spawn_blocking({
            let path = to_path.clone();
            let orient = orientation.clone();
            move || crate::load_and_scale_image_with_orientation(&path, width, height, &orient)
        })
        .await
        {
            Ok(Ok(img)) => img,
            Ok(Err(e)) => {
                eprintln!("❌ Pre-compute: Failed to load to image: {}", e);
                Self::mark_invalidated(&precompute_arc).await;
                return;
            }
            Err(e) => {
                eprintln!("❌ Pre-compute: Task join error loading to image: {}", e);
                Self::mark_invalidated(&precompute_arc).await;
                return;
            }
        };

        println!(
            "🔄 Pre-compute: Images loaded in {:?}, computing {} frames...",
            start_time.elapsed(),
            frame_count
        );

        // Process frames in batches using rayon for parallel computation
        const BATCH_SIZE: usize = 5;

        for batch_start in (0..frame_count).step_by(BATCH_SIZE) {
            // Check cancellation
            if *cancel_token.read().await {
                println!("🔄 Pre-compute: Cancelled");
                Self::mark_invalidated(&precompute_arc).await;
                return;
            }

            let batch_end = (batch_start + BATCH_SIZE).min(frame_count);

            // Compute batch frames in parallel using rayon, then convert to BGRA buffers
            let batch_buffers: Vec<Vec<u8>> = match tokio::task::spawn_blocking({
                let from_img = from_img.clone();
                let to_img = to_img.clone();
                let frame_generator = frame_generator.clone();
                move || {
                    use rayon::prelude::*;
                    (batch_start..batch_end)
                        .into_par_iter()
                        .map(|i| {
                            let progress = if frame_count > 1 {
                                i as f32 / (frame_count - 1) as f32
                            } else {
                                1.0
                            };
                            let rgba_frame = frame_generator(&from_img, &to_img, progress);
                            // Convert to BGRA buffer immediately (still parallelized)
                            rgba_to_bgra_buffer(&rgba_frame)
                        })
                        .collect()
                }
            })
            .await
            {
                Ok(buffers) => buffers,
                Err(e) => {
                    eprintln!("❌ Pre-compute: Batch computation failed: {}", e);
                    Self::mark_invalidated(&precompute_arc).await;
                    return;
                }
            };

            // Store batch BGRA buffers
            let mut precompute = precompute_arc.write().await;
            if let Some(ref mut p) = *precompute {
                p.frames.extend(batch_buffers);
                let completed = p.frames.len();
                p.status = if completed >= frame_count {
                    PrecomputeStatus::Ready
                } else {
                    PrecomputeStatus::InProgress {
                        frames_completed: completed,
                        total_frames: frame_count,
                    }
                };
            }
        }

        let elapsed = start_time.elapsed();
        println!(
            "✅ Pre-compute complete: {} frames for '{}' in {:?}",
            frame_count, transition_name, elapsed
        );
    }

    async fn mark_invalidated(precompute_arc: &Arc<RwLock<Option<PrecomputedTransition>>>) {
        let mut precompute = precompute_arc.write().await;
        if let Some(ref mut p) = *precompute {
            p.status = PrecomputeStatus::Invalidated;
            p.frames.clear();
            p.frames.shrink_to_fit();
        }
    }

    /// Get memory usage estimate in bytes
    pub async fn get_memory_usage(&self) -> usize {
        let precompute = self.current_precompute.read().await;
        match &*precompute {
            Some(p) => {
                // Each frame is width * height * 4 bytes
                let frame_size = (self.width * self.height * 4) as usize;
                p.frames.len() * frame_size
            }
            None => 0,
        }
    }
}

impl Clone for TransitionPrecomputer {
    fn clone(&self) -> Self {
        Self {
            current_precompute: self.current_precompute.clone(),
            cancel_token: self.cancel_token.clone(),
            width: self.width,
            height: self.height,
            target_fps: self.target_fps,
        }
    }
}
