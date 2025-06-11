use clap::Parser;
use image::{ImageError, Rgba, RgbaImage};
use memmap2::MmapMut;
use notify::{
    Event, EventKind, RecommendedWatcher, RecursiveMode, Result as NotifyResult, Watcher,
};
use signal_hook::{consts::{SIGINT, SIGTERM}, iterator::Signals};
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Result as IoResult, Seek, SeekFrom, Write};
use std::os::unix::io::AsRawFd;
use std::os::unix::fs::{FileTypeExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc as async_mpsc};

#[derive(Debug, Clone, PartialEq)]
enum Orientation {
    Landscape,
    Portrait,
}

impl From<&str> for Orientation {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "portrait" => Orientation::Portrait,
            _ => Orientation::Landscape,
        }
    }
}

impl Orientation {
    fn dimensions(&self) -> (u32, u32) {
        match self {
            Orientation::Landscape => (DEFAULT_LANDSCAPE_WIDTH, DEFAULT_LANDSCAPE_HEIGHT),
            Orientation::Portrait => (DEFAULT_PORTRAIT_WIDTH, DEFAULT_PORTRAIT_HEIGHT),
        }
    }
}

mod mqtt_client;
mod slideshow_controller;
mod http_server;
mod couchdb_client;

use mqtt_client::{MqttClient, SlideshowCommand, TvStatus};
use slideshow_controller::{ControllerConfig, SlideshowController};

// Default landscape dimensions
const DEFAULT_LANDSCAPE_WIDTH: u32 = 1920;
const DEFAULT_LANDSCAPE_HEIGHT: u32 = 1080;
const DEFAULT_PORTRAIT_WIDTH: u32 = 1080;
const DEFAULT_PORTRAIT_HEIGHT: u32 = 1920;
const MAX_FRAMEBUFFER_SIZE: usize = 1920 * 1920 * 4; // Support up to 1920x1920

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Directory containing images to display
    #[arg(short, long, default_value = ".")]
    image_dir: PathBuf,

    /// Duration in seconds to display each image
    #[arg(short, long, default_value_t = 30)]
    delay: u64,

    /// Transition duration in milliseconds
    #[arg(short, long, default_value_t = 1500)]
    transition: u64,

    /// Framebuffer device path
    #[arg(short, long, default_value = "/dev/fb0")]
    framebuffer: PathBuf,

    /// MQTT broker URL
    #[arg(long, default_value = "mqtt://192.168.1.215:1883")]
    mqtt_broker: String,

    /// CouchDB server URL
    #[arg(long, default_value = "http://localhost:5984")]
    couchdb_url: String,

    /// CouchDB username (optional)
    #[arg(long)]
    couchdb_username: Option<String>,

    /// CouchDB password (optional)
    #[arg(long)]
    couchdb_password: Option<String>,

    /// TV ID (auto-generated if not provided)
    #[arg(long)]
    tv_id: Option<String>,

    /// Enable MQTT remote control
    #[arg(long, default_value_t = true)]
    enable_mqtt: bool,

    /// HTTP server port for local control
    #[arg(long, default_value_t = 8080)]
    http_port: u16,

    /// Display orientation (landscape or portrait)
    #[arg(long, default_value = "landscape")]
    orientation: String,
}

struct Config {
    image_dir: PathBuf,
    display_duration: Duration,
    transition_duration: Duration,
    framebuffer_path: PathBuf,
    orientation: Orientation,
}

impl From<Args> for Config {
    fn from(args: Args) -> Self {
        Self {
            image_dir: args.image_dir,
            display_duration: Duration::from_secs(args.delay),
            transition_duration: Duration::from_millis(args.transition),
            framebuffer_path: args.framebuffer,
            orientation: Orientation::from(args.orientation.as_str()),
        }
    }
}

#[derive(Debug, Clone)]
enum TransitionType {
    Fade,
    Dissolve,
    SlideLeft,
    SlideRight,
    SlideUp,
    SlideDown,
    WipeLeft,
    WipeRight,
    WipeUp,
    WipeDown,
    Morph,
    Bounce,
    Elastic,
    EaseIn,
    EaseOut,
    EaseInOut,
    Accelerated,
    CircularWipe,
    DiagonalWipe,
    Pixelate,
}

impl TransitionType {
    fn get_random() -> Self {
        let transitions = [
            Self::Fade,
            Self::Dissolve,
            Self::SlideLeft,
            Self::SlideRight,
            Self::SlideUp,
            Self::SlideDown,
            Self::WipeLeft,
            Self::WipeRight,
            Self::WipeUp,
            Self::WipeDown,
            Self::Morph,
            Self::Bounce,
            Self::Elastic,
            Self::EaseIn,
            Self::EaseOut,
            Self::EaseInOut,
            Self::Accelerated,
            Self::CircularWipe,
            Self::DiagonalWipe,
            Self::Pixelate,
        ];
        transitions[fastrand::usize(..transitions.len())].clone()
    }

    fn name(&self) -> &'static str {
        match self {
            Self::Fade => "FADE",
            Self::Dissolve => "DISSOLVE",
            Self::SlideLeft => "SLIDE LEFT",
            Self::SlideRight => "SLIDE RIGHT",
            Self::SlideUp => "SLIDE UP",
            Self::SlideDown => "SLIDE DOWN",
            Self::WipeLeft => "WIPE LEFT",
            Self::WipeRight => "WIPE RIGHT",
            Self::WipeUp => "WIPE UP",
            Self::WipeDown => "WIPE DOWN",
            Self::Morph => "MORPH",
            Self::Bounce => "BOUNCE",
            Self::Elastic => "ELASTIC",
            Self::EaseIn => "EASE IN",
            Self::EaseOut => "EASE OUT",
            Self::EaseInOut => "EASE IN-OUT",
            Self::Accelerated => "ACCELERATED",
            Self::CircularWipe => "CIRCULAR WIPE",
            Self::DiagonalWipe => "DIAGONAL WIPE",
            Self::Pixelate => "PIXELATE",
        }
    }
}

#[derive(Debug)]
enum SlideshowEvent {
    NewImage(PathBuf),
    Shutdown,
}

struct Framebuffer {
    file: Option<File>,
    mmap: Option<MmapMut>,
    width: u32,
    height: u32,
    max_buffer_size: usize,
    fallback_file: Option<BufWriter<File>>,
}

impl Framebuffer {
    fn new(width: u32, height: u32, framebuffer_path: &Path) -> IoResult<Self> {
        match OpenOptions::new()
            .read(true)
            .write(true)
            .open(framebuffer_path)
        {
            Ok(f) => {
                // Get framebuffer info using ioctl
                Self::log_framebuffer_info(&f);

                // Try to memory map the framebuffer
                match unsafe { MmapMut::map_mut(&f) } {
                    Ok(mmap) => {
                        if mmap.len() == 0 {
                            println!("Memory-mapped framebuffer has 0 bytes, falling back to direct writes");
                            // Reset file to write-only mode for direct writes
                            drop(mmap);
                            drop(f);
                            let f = OpenOptions::new().write(true).open(framebuffer_path)?;
                            Ok(Framebuffer {
                                file: Some(f),
                                mmap: None,
                                fallback_file: None,
                                max_buffer_size: MAX_FRAMEBUFFER_SIZE,
                                width,
                                height,
                            })
                        } else {
                            println!(
                                "Successfully memory-mapped framebuffer device (size: {} bytes)",
                                mmap.len()
                            );
                            Ok(Framebuffer {
                                file: Some(f),
                                mmap: Some(mmap),
                                fallback_file: None,
                                max_buffer_size: MAX_FRAMEBUFFER_SIZE,
                                width,
                                height,
                            })
                        }
                    }
                    Err(mmap_err) => {
                        println!("Memory mapping failed ({}), trying direct writes", mmap_err);
                        // Reset file to write-only mode for direct writes
                        drop(f);
                        let f = OpenOptions::new().write(true).open(framebuffer_path)?;
                        Ok(Framebuffer {
                            file: Some(f),
                            mmap: None,
                            fallback_file: None,
                            max_buffer_size: MAX_FRAMEBUFFER_SIZE,
                            width,
                            height,
                        })
                    }
                }
            }
            Err(e) => {
                println!("Failed to open framebuffer ({}), using file fallback", e);
                let fallback = File::create("framebuffer_output.raw")?;
                Ok(Framebuffer {
                    file: None,
                    mmap: None,
                    fallback_file: Some(BufWriter::new(fallback)),
                    max_buffer_size: MAX_FRAMEBUFFER_SIZE,
                    width,
                    height,
                })
            }
        }
    }

    fn display_buffer(&mut self, buffer: &[u8]) -> IoResult<()> {
        if buffer.len() > self.max_buffer_size {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!(
                    "Buffer size {} exceeds maximum framebuffer size {}",
                    buffer.len(),
                    self.max_buffer_size
                ),
            ));
        }

        if let Some(ref mut mmap) = self.mmap {
            // Use memory mapping for fast, efficient writes
            let copy_len = std::cmp::min(buffer.len(), mmap.len());
            if copy_len == 0 {
                println!("Warning: mmap size is 0 bytes, cannot write to framebuffer. Buffer size: {}, mmap size: {}", buffer.len(), mmap.len());
                return Ok(());
            }
            mmap[..copy_len].copy_from_slice(&buffer[..copy_len]);
            mmap.flush()?;
        } else if let Some(ref mut file) = self.file {
            // Fallback to direct file writes - reset to beginning and write entire buffer
            file.seek(SeekFrom::Start(0))?;
            
            // Writing buffer to framebuffer device
            
            // For framebuffer devices, we should write the full buffer at once for proper synchronization
            // but break it into reasonable chunks to avoid system limits
            const CHUNK_SIZE: usize = 4096; // 4KB chunks for better compatibility
            let mut bytes_written = 0;
            
            for chunk in buffer.chunks(CHUNK_SIZE) {
                match file.write_all(chunk) {
                    Ok(()) => {
                        bytes_written += chunk.len();
                    }
                    Err(e) => {
                        eprintln!("Failed to write chunk to framebuffer at offset {}: {}", bytes_written, e);
                        return Err(e);
                    }
                }
            }
            
            // Ensure data is written to the device
            file.flush()?;
            // Successfully wrote framebuffer data
        } else if let Some(ref mut fallback) = self.fallback_file {
            fallback.write_all(buffer)?;
            fallback.flush()?;
            println!("Wrote {} bytes to fallback file", buffer.len());
        }
        Ok(())
    }

    fn display_image(&mut self, image: &RgbaImage) -> IoResult<()> {
        let buffer = self.image_to_bgra_buffer(image);
        self.display_buffer(&buffer)
    }

    fn image_to_bgra_buffer(&self, image: &RgbaImage) -> Vec<u8> {
        // Converting image to framebuffer format
        
        // If image dimensions don't match framebuffer exactly, this could cause garbled display
        if image.width() != self.width || image.height() != self.height {
            println!("WARNING: Image dimensions {}x{} don't match framebuffer {}x{} - this may cause garbled display!", 
                     image.width(), image.height(), self.width, self.height);
        }
        
        let expected_size = (self.width * self.height * 4) as usize;
        let max_pixels = self.max_buffer_size / 4;
        let actual_pixels = (self.width * self.height) as usize;

        if actual_pixels > max_pixels {
            println!(
                "Warning: Image dimensions {}x{} exceed framebuffer capacity. Truncating to fit.",
                self.width, self.height
            );
        }

        let safe_size = std::cmp::min(expected_size, self.max_buffer_size);
        let safe_pixels = safe_size / 4;
        let mut buffer = Vec::with_capacity(safe_size);

        let mut pixels_written = 0;

        // Important: Make sure we're writing in the correct order for the framebuffer
        // The framebuffer expects data in scanline order (left-to-right, top-to-bottom)
        for y in 0..self.height {
            for x in 0..self.width {
                if pixels_written >= safe_pixels {
                    break;
                }

                let pixel = if x < image.width() && y < image.height() {
                    *image.get_pixel(x, y)
                } else {
                    Rgba([0, 0, 0, 255])
                };

                // Convert RGBA to BGRA (keeping alpha channel)
                buffer.push(pixel[2]); // B
                buffer.push(pixel[1]); // G
                buffer.push(pixel[0]); // R
                buffer.push(pixel[3]); // A

                pixels_written += 1;
            }

            if pixels_written >= safe_pixels {
                break;
            }
        }

        // Generated framebuffer buffer
        buffer
    }

    fn log_framebuffer_info(file: &File) {
        // Try to get framebuffer information
        let fd = file.as_raw_fd();

        // Basic file size check
        if let Ok(metadata) = file.metadata() {
            println!("Framebuffer device size: {} bytes", metadata.len());
            println!("Framebuffer device type: {:?}", metadata.file_type());
            println!("Framebuffer device permissions: {:o}", metadata.permissions().mode());
        } else {
            println!("Failed to get framebuffer metadata");
        }

        // Check if the file is a character device (framebuffers are char devices)
        if let Ok(metadata) = file.metadata() {
            if metadata.file_type().is_char_device() {
                println!("Framebuffer is a character device (correct)");
            } else {
                println!("WARNING: Framebuffer is NOT a character device");
            }
        }

        println!("Framebuffer device fd: {}", fd);
    }
}

struct ImageManager {
    images: Vec<PathBuf>,
    current_index: usize,
}

impl ImageManager {
    fn new() -> Self {
        Self {
            images: Vec::new(),
            current_index: 0,
        }
    }

    fn scan_images(&mut self, image_dir: &Path) -> IoResult<()> {
        self.images.clear();

        for entry in std::fs::read_dir(image_dir)? {
            let entry = entry?;
            let path = entry.path();

            if let Some(ext) = path.extension() {
                let ext_lower = ext.to_string_lossy().to_lowercase();
                if ext_lower == "png" || ext_lower == "jpg" || ext_lower == "jpeg" {
                    self.images.push(path);
                }
            }
        }

        self.images.sort();
        println!("Found {} images (PNG/JPG/JPEG)", self.images.len());
        Ok(())
    }

    fn load_and_scale_image(&self, path: &Path, width: u32, height: u32) -> Result<RgbaImage, ImageError> {
        println!("Loading image: {}", path.display());
        let img = image::open(path).map_err(|e| {
            eprintln!("Failed to load image {}: {}", path.display(), e);
            e
        })?;
        println!("Successfully loaded image format: {:?}", img.color());
        let mut original_img = img.to_rgba8();
        
        // Determine if we need to rotate for portrait display
        let display_is_portrait = height > width;
        let image_is_landscape = original_img.width() > original_img.height();
        
        // Rotate landscape images 90° clockwise for portrait displays
        if display_is_portrait && image_is_landscape {
            original_img = image::imageops::rotate90(&original_img);
        }
        
        // Calculate scaling factor to fit within target dimensions while preserving aspect ratio
        let original_width = original_img.width() as f32;
        let original_height = original_img.height() as f32;
        let target_width = width as f32;
        let target_height = height as f32;
        
        let scale_x = target_width / original_width;
        let scale_y = target_height / original_height;
        let scale = scale_x.min(scale_y); // Use smaller scale to fit within bounds
        
        let scaled_width = (original_width * scale) as u32;
        let scaled_height = (original_height * scale) as u32;
        
        // Scale the image while preserving aspect ratio
        let scaled_img = image::imageops::resize(
            &original_img,
            scaled_width,
            scaled_height,
            image::imageops::FilterType::Lanczos3,
        );
        
        // Create a black background image at target resolution
        let mut result = RgbaImage::new(width, height);
        for pixel in result.pixels_mut() {
            *pixel = Rgba([0, 0, 0, 255]); // Black background
        }
        
        // Center the scaled image on the black background
        let x_offset = (width - scaled_width) / 2;
        let y_offset = (height - scaled_height) / 2;
        
        // Copy the scaled image to the center of the result
        for y in 0..scaled_height {
            for x in 0..scaled_width {
                let pixel = *scaled_img.get_pixel(x, y);
                result.put_pixel(x + x_offset, y + y_offset, pixel);
            }
        }
        
        Ok(result)
    }

    fn apply_easing(t: f32, easing_type: &TransitionType) -> f32 {
        match easing_type {
            TransitionType::EaseIn => t * t,
            TransitionType::EaseOut => 1.0 - (1.0 - t) * (1.0 - t),
            TransitionType::EaseInOut => {
                if t < 0.5 {
                    2.0 * t * t
                } else {
                    1.0 - 2.0 * (1.0 - t) * (1.0 - t)
                }
            }
            TransitionType::Bounce => {
                if t < 0.5 {
                    4.0 * t * t * t
                } else {
                    let f = 2.0 * t - 2.0;
                    1.0 + f * f * f + 1.0
                }
            }
            TransitionType::Elastic => {
                if t == 0.0 {
                    0.0
                } else if t == 1.0 {
                    1.0
                } else if t < 0.5 {
                    -(2.0_f32.powf(20.0 * t - 10.0))
                        * ((20.0 * t - 11.125) * std::f32::consts::PI / 4.5).sin()
                        / 2.0
                } else {
                    2.0_f32.powf(-20.0 * t + 10.0)
                        * ((20.0 * t - 11.125) * std::f32::consts::PI / 4.5).sin()
                        / 2.0
                        + 1.0
                }
            }
            TransitionType::Accelerated => t * t * t,
            _ => t, // Linear for other types
        }
    }

    fn create_transition_frame(
        &self,
        img1: &RgbaImage,
        img2: &RgbaImage,
        progress: f32,
        transition_type: &TransitionType,
        transition_name: &str,
    ) -> RgbaImage {
        let width = img1.width();
        let height = img1.height();
        let mut result = RgbaImage::new(width, height);

        // Apply transition-specific easing
        let eased_progress = Self::apply_easing(progress, transition_type);

        match transition_type {
            TransitionType::Fade => {
                self.blend_images_simple(img1, img2, eased_progress, &mut result);
            }
            TransitionType::Dissolve => {
                self.dissolve_transition(img1, img2, eased_progress, &mut result);
            }
            TransitionType::SlideLeft => {
                self.slide_transition(img1, img2, eased_progress, &mut result, -1, 0);
            }
            TransitionType::SlideRight => {
                self.slide_transition(img1, img2, eased_progress, &mut result, 1, 0);
            }
            TransitionType::SlideUp => {
                self.slide_transition(img1, img2, eased_progress, &mut result, 0, -1);
            }
            TransitionType::SlideDown => {
                self.slide_transition(img1, img2, eased_progress, &mut result, 0, 1);
            }
            TransitionType::WipeLeft => {
                self.wipe_transition(img1, img2, eased_progress, &mut result, 0);
            }
            TransitionType::WipeRight => {
                self.wipe_transition(img1, img2, eased_progress, &mut result, 1);
            }
            TransitionType::WipeUp => {
                self.wipe_transition(img1, img2, eased_progress, &mut result, 2);
            }
            TransitionType::WipeDown => {
                self.wipe_transition(img1, img2, eased_progress, &mut result, 3);
            }
            TransitionType::CircularWipe => {
                self.circular_wipe_transition(img1, img2, eased_progress, &mut result);
            }
            TransitionType::DiagonalWipe => {
                self.diagonal_wipe_transition(img1, img2, eased_progress, &mut result);
            }
            TransitionType::Pixelate => {
                self.pixelate_transition(img1, img2, eased_progress, &mut result);
            }
            TransitionType::Morph => {
                self.morph_transition(img1, img2, eased_progress, &mut result);
            }
            _ => {
                // For easing transitions, use simple blend with the easing applied
                self.blend_images_simple(img1, img2, eased_progress, &mut result);
            }
        }

        // Add transition name text overlay
        self.add_transition_text(&mut result, transition_name);

        result
    }

    fn blend_images_simple(
        &self,
        img1: &RgbaImage,
        img2: &RgbaImage,
        alpha: f32,
        result: &mut RgbaImage,
    ) {
        let width = img1.width();
        let height = img1.height();

        for y in 0..height {
            for x in 0..width {
                let p1 = img1.get_pixel(x, y);
                let p2 = img2.get_pixel(x, y);

                let r = (p1[0] as f32 * (1.0 - alpha) + p2[0] as f32 * alpha) as u8;
                let g = (p1[1] as f32 * (1.0 - alpha) + p2[1] as f32 * alpha) as u8;
                let b = (p1[2] as f32 * (1.0 - alpha) + p2[2] as f32 * alpha) as u8;
                let a = (p1[3] as f32 * (1.0 - alpha) + p2[3] as f32 * alpha) as u8;

                result.put_pixel(x, y, Rgba([r, g, b, a]));
            }
        }
    }

    fn dissolve_transition(
        &self,
        img1: &RgbaImage,
        img2: &RgbaImage,
        progress: f32,
        result: &mut RgbaImage,
    ) {
        let width = img1.width();
        let height = img1.height();

        for y in 0..height {
            for x in 0..width {
                let random_threshold = fastrand::f32();
                let pixel = if random_threshold < progress {
                    *img2.get_pixel(x, y)
                } else {
                    *img1.get_pixel(x, y)
                };
                result.put_pixel(x, y, pixel);
            }
        }
    }

    fn slide_transition(
        &self,
        img1: &RgbaImage,
        img2: &RgbaImage,
        progress: f32,
        result: &mut RgbaImage,
        dir_x: i32,
        dir_y: i32,
    ) {
        let width = img1.width() as i32;
        let height = img1.height() as i32;

        let offset_x = (width as f32 * progress * dir_x as f32) as i32;
        let offset_y = (height as f32 * progress * dir_y as f32) as i32;

        for y in 0..height {
            for x in 0..width {
                let img1_x = x - offset_x;
                let img1_y = y - offset_y;
                let img2_x = x - offset_x + width * dir_x;
                let img2_y = y - offset_y + height * dir_y;

                let pixel = if img2_x >= 0 && img2_x < width && img2_y >= 0 && img2_y < height {
                    *img2.get_pixel(img2_x as u32, img2_y as u32)
                } else if img1_x >= 0 && img1_x < width && img1_y >= 0 && img1_y < height {
                    *img1.get_pixel(img1_x as u32, img1_y as u32)
                } else {
                    Rgba([0, 0, 0, 255])
                };

                result.put_pixel(x as u32, y as u32, pixel);
            }
        }
    }

    fn wipe_transition(
        &self,
        img1: &RgbaImage,
        img2: &RgbaImage,
        progress: f32,
        result: &mut RgbaImage,
        direction: u32,
    ) {
        let width = img1.width();
        let height = img1.height();

        for y in 0..height {
            for x in 0..width {
                let should_show_img2 = match direction {
                    0 => (x as f32 / width as f32) < progress,          // Left
                    1 => (x as f32 / width as f32) > (1.0 - progress),  // Right
                    2 => (y as f32 / height as f32) > (1.0 - progress), // Up
                    3 => (y as f32 / height as f32) < progress,         // Down
                    _ => false,
                };

                let pixel = if should_show_img2 {
                    *img2.get_pixel(x, y)
                } else {
                    *img1.get_pixel(x, y)
                };

                result.put_pixel(x, y, pixel);
            }
        }
    }

    fn circular_wipe_transition(
        &self,
        img1: &RgbaImage,
        img2: &RgbaImage,
        progress: f32,
        result: &mut RgbaImage,
    ) {
        let width = img1.width() as f32;
        let height = img1.height() as f32;
        let center_x = width / 2.0;
        let center_y = height / 2.0;
        let max_radius = ((width * width + height * height) / 4.0).sqrt();
        let current_radius = max_radius * progress;

        for y in 0..height as u32 {
            for x in 0..width as u32 {
                let dx = x as f32 - center_x;
                let dy = y as f32 - center_y;
                let distance = (dx * dx + dy * dy).sqrt();

                let pixel = if distance < current_radius {
                    *img2.get_pixel(x, y)
                } else {
                    *img1.get_pixel(x, y)
                };

                result.put_pixel(x, y, pixel);
            }
        }
    }

    fn diagonal_wipe_transition(
        &self,
        img1: &RgbaImage,
        img2: &RgbaImage,
        progress: f32,
        result: &mut RgbaImage,
    ) {
        let width = img1.width() as f32;
        let height = img1.height() as f32;
        let diagonal_length = width + height;
        let current_position = diagonal_length * progress;

        for y in 0..height as u32 {
            for x in 0..width as u32 {
                let diagonal_pos = x as f32 + y as f32;

                let pixel = if diagonal_pos < current_position {
                    *img2.get_pixel(x, y)
                } else {
                    *img1.get_pixel(x, y)
                };

                result.put_pixel(x, y, pixel);
            }
        }
    }

    fn pixelate_transition(
        &self,
        img1: &RgbaImage,
        img2: &RgbaImage,
        progress: f32,
        result: &mut RgbaImage,
    ) {
        let width = img1.width();
        let height = img1.height();
        let block_size = (1.0 + (1.0 - progress) * 15.0) as u32; // From 16x16 to 1x1 blocks

        for y in (0..height).step_by(block_size as usize) {
            for x in (0..width).step_by(block_size as usize) {
                let use_img2 = fastrand::f32() < progress;
                let source_img = if use_img2 { img2 } else { img1 };
                let sample_pixel = *source_img.get_pixel(x, y);

                for by in 0..block_size {
                    for bx in 0..block_size {
                        let px = x + bx;
                        let py = y + by;
                        if px < width && py < height {
                            result.put_pixel(px, py, sample_pixel);
                        }
                    }
                }
            }
        }
    }

    fn morph_transition(
        &self,
        img1: &RgbaImage,
        img2: &RgbaImage,
        progress: f32,
        result: &mut RgbaImage,
    ) {
        let width = img1.width();
        let height = img1.height();
        let distortion = progress * 0.1; // Maximum 10% distortion

        for y in 0..height {
            for x in 0..width {
                // Create wave distortion effect
                let wave_x = (y as f32 * 0.02 + progress * 6.28).sin() * distortion * width as f32;
                let wave_y = (x as f32 * 0.02 + progress * 6.28).cos() * distortion * height as f32;

                let src_x = ((x as f32 + wave_x) as i32).max(0).min(width as i32 - 1) as u32;
                let src_y = ((y as f32 + wave_y) as i32).max(0).min(height as i32 - 1) as u32;

                let p1 = img1.get_pixel(src_x, src_y);
                let p2 = img2.get_pixel(x, y);

                let r = (p1[0] as f32 * (1.0 - progress) + p2[0] as f32 * progress) as u8;
                let g = (p1[1] as f32 * (1.0 - progress) + p2[1] as f32 * progress) as u8;
                let b = (p1[2] as f32 * (1.0 - progress) + p2[2] as f32 * progress) as u8;
                let a = (p1[3] as f32 * (1.0 - progress) + p2[3] as f32 * progress) as u8;

                result.put_pixel(x, y, Rgba([r, g, b, a]));
            }
        }
    }

    fn add_transition_text(&self, image: &mut RgbaImage, transition_name: &str) {
        let char_size = 4;
        let text_color = Rgba([255, 255, 0, 255]); // Bright yellow
        let bg_color = Rgba([0, 0, 0, 180]); // Semi-transparent black background

        // Calculate text dimensions
        let char_width = 7 * char_size;
        let char_spacing = char_size;
        let text_width = transition_name.len() as u32 * (char_width + char_spacing);
        let text_height = 5 * char_size;

        // Draw background rectangle
        let padding = char_size * 2;
        let bg_width = text_width + padding * 2;
        let bg_height = text_height + padding * 2;

        for y in 0..bg_height {
            for x in 0..bg_width {
                if x < image.width() && y < image.height() {
                    image.put_pixel(x, y, bg_color);
                }
            }
        }

        // Draw text
        draw_text(
            image,
            transition_name,
            padding,
            padding,
            char_size,
            text_color,
        );
    }

    fn play_transition(
        &self,
        from_idx: usize,
        to_idx: usize,
        fb: &mut Framebuffer,
        transition_duration: Duration,
    ) -> IoResult<()> {
        // Choose random transition type
        let transition_type = TransitionType::get_random();
        let transition_name = transition_type.name();

        println!(
            "Playing {} transition: {} -> {}",
            transition_name,
            self.images[from_idx].display(),
            self.images[to_idx].display()
        );

        // Load source images
        let from_img = self
            .load_and_scale_image(&self.images[from_idx], fb.width, fb.height)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        let to_img = self
            .load_and_scale_image(&self.images[to_idx], fb.width, fb.height)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

        let frame_count = (transition_duration.as_millis() / 33) as usize; // ~30 FPS
        let frame_duration = transition_duration / frame_count as u32;

        println!(
            "Generating {} transition frames at {}ms per frame",
            frame_count,
            frame_duration.as_millis()
        );

        for i in 0..frame_count {
            let start = Instant::now();

            // Generate transition frame with selected effect
            let progress = i as f32 / (frame_count - 1) as f32;
            let transition_frame = self.create_transition_frame(
                &from_img,
                &to_img,
                progress,
                &transition_type,
                transition_name,
            );
            let buffer = fb.image_to_bgra_buffer(&transition_frame);

            fb.display_buffer(&buffer)?;

            if i % 10 == 0 {
                println!(
                    "Generated and played {} transition frame {}/{}",
                    transition_name,
                    i + 1,
                    frame_count
                );
            }

            let elapsed = start.elapsed();
            if elapsed < frame_duration {
                thread::sleep(frame_duration - elapsed);
            }
        }

        println!("{} transition completed", transition_name);
        Ok(())
    }

    fn add_new_image(&mut self, path: PathBuf) -> Option<usize> {
        if !self.images.contains(&path) {
            println!("Added new image to queue: {}", path.display());
            self.images.push(path.clone());
            self.images.sort();
            // Return the index of the newly added image after sorting
            self.images.iter().position(|p| *p == path)
        } else {
            None
        }
    }
}

fn setup_filesystem_watcher(tx: Sender<SlideshowEvent>, watch_dir: &Path) -> NotifyResult<RecommendedWatcher> {
    let mut watcher = notify::recommended_watcher(move |res: NotifyResult<Event>| {
        match res {
            Ok(event) => {
                if let EventKind::Create(_) = event.kind {
                    for path in event.paths {
                        if let Some(ext) = path.extension() {
                            let ext_lower = ext.to_string_lossy().to_lowercase();
                            if ext_lower == "png" || ext_lower == "jpg" || ext_lower == "jpeg" {
                                // Normalize the path to remove any redundant components
                                let normalized_path = if path.is_absolute() {
                                    // Convert absolute path to relative by getting just the filename
                                    match path.file_name() {
                                        Some(filename) => PathBuf::from(filename),
                                        None => path,
                                    }
                                } else {
                                    path
                                };
                                let _ = tx.send(SlideshowEvent::NewImage(normalized_path));
                            }
                        }
                    }
                }
            }
            Err(e) => println!("Filesystem watch error: {:?}", e),
        }
    })?;

    watcher.watch(watch_dir, RecursiveMode::NonRecursive)?;
    Ok(watcher)
}

fn setup_signal_handler(tx: Sender<SlideshowEvent>) -> std::thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut signals = Signals::new(&[SIGINT, SIGTERM]).unwrap();
        for sig in signals.forever() {
            match sig {
                SIGINT => println!("\nReceived SIGINT, shutting down..."),
                SIGTERM => println!("\nReceived SIGTERM, shutting down..."),
                _ => println!("\nReceived signal {}, shutting down...", sig),
            }
            let _ = tx.send(SlideshowEvent::Shutdown);
            break;
        }
    })
}

fn get_random_joke() -> &'static str {
    let jokes = [
        "Why don't scientists trust atoms? Because they make up everything!",
        "Why did the scarecrow win an award? He was outstanding in his field!",
        "I told my wife she was drawing her eyebrows too high. She looked surprised.",
        "Why don't skeletons fight each other? They don't have the guts.",
        "What do you call a fake noodle? An impasta!",
        "Why did the math book look so sad? Because it had too many problems.",
        "What's the best thing about Switzerland? I don't know, but the flag is a big plus.",
        "Why can't a bicycle stand up by itself? It's two tired!",
        "What do you call a fish wearing a crown? A king fish!",
        "Why don't eggs tell jokes? They'd crack each other up!",
        "What do you call a sleeping bull? A bulldozer!",
        "Why did the coffee file a police report? It got mugged!",
        "What's orange and sounds like a parrot? A carrot!",
        "Why don't programmers like nature? It has too many bugs.",
        "What do you call a bear with no teeth? A gummy bear!",
        "Why did the pixel break up with the screen? It needed more space!",
        "What's a computer's favorite snack? Microchips!",
        "Why do Raspberry Pis make terrible comedians? Their timing is always off by a few milliseconds!",
        "What did the framebuffer say to the GPU? 'You complete me... at 60fps!'",
        "Why don't graphics cards ever get lonely? They're always processing in parallel!"
    ];

    let index = fastrand::usize(..jokes.len());
    jokes[index]
}

fn draw_simple_char(
    image: &mut RgbaImage,
    c: char,
    x_offset: u32,
    y_offset: u32,
    char_size: u32,
    color: Rgba<u8>,
) {
    // Simple bitmap font for basic characters
    let patterns = match c {
        'A' => vec!["  ███  ", " █   █ ", "███████", "█     █", "█     █"],
        'B' => vec!["██████ ", "█     █", "██████ ", "█     █", "██████ "],
        'C' => vec![" ██████", "█      ", "█      ", "█      ", " ██████"],
        'D' => vec!["██████ ", "█     █", "█     █", "█     █", "██████ "],
        'E' => vec!["███████", "█      ", "██████ ", "█      ", "███████"],
        'F' => vec!["███████", "█      ", "██████ ", "█      ", "█      "],
        'G' => vec![" ██████", "█      ", "█  ████", "█     █", " ██████"],
        'H' => vec!["█     █", "█     █", "███████", "█     █", "█     █"],
        'I' => vec!["███████", "   █   ", "   █   ", "   █   ", "███████"],
        'J' => vec!["███████", "    █  ", "    █  ", "█   █  ", " ███   "],
        'K' => vec!["█    █ ", "█   █  ", "████   ", "█   █  ", "█    █ "],
        'L' => vec!["█      ", "█      ", "█      ", "█      ", "███████"],
        'M' => vec!["█     █", "██   ██", "█ █ █ █", "█  █  █", "█     █"],
        'N' => vec!["█     █", "██    █", "█ █   █", "█  █  █", "█   ███"],
        'O' => vec![" █████ ", "█     █", "█     █", "█     █", " █████ "],
        'P' => vec!["██████ ", "█     █", "██████ ", "█      ", "█      "],
        'Q' => vec![" █████ ", "█     █", "█  █  █", "█   █ █", " ██████"],
        'R' => vec!["██████ ", "█     █", "██████ ", "█   █  ", "█    █ "],
        'S' => vec![" ██████", "█      ", " █████ ", "      █", "██████ "],
        'T' => vec!["███████", "   █   ", "   █   ", "   █   ", "   █   "],
        'U' => vec!["█     █", "█     █", "█     █", "█     █", " █████ "],
        'V' => vec!["█     █", "█     █", "█     █", " █   █ ", "  ███  "],
        'W' => vec!["█     █", "█  █  █", "█ █ █ █", "██   ██", "█     █"],
        'X' => vec!["█     █", " █   █ ", "  ███  ", " █   █ ", "█     █"],
        'Y' => vec!["█     █", " █   █ ", "  ███  ", "   █   ", "   █   "],
        'Z' => vec!["███████", "     █ ", "   ██  ", " ██    ", "███████"],
        '0' => vec![" █████ ", "█     █", "█     █", "█     █", " █████ "],
        '1' => vec!["   █   ", "  ██   ", "   █   ", "   █   ", "███████"],
        '2' => vec![" █████ ", "      █", " █████ ", "█      ", "███████"],
        '3' => vec![" █████ ", "      █", "  ████ ", "      █", " █████ "],
        '4' => vec!["█     █", "█     █", "███████", "      █", "      █"],
        '5' => vec!["███████", "█      ", "██████ ", "      █", "██████ "],
        '6' => vec![" █████ ", "█      ", "██████ ", "█     █", " █████ "],
        '7' => vec!["███████", "      █", "     █ ", "    █  ", "   █   "],
        '8' => vec![" █████ ", "█     █", " █████ ", "█     █", " █████ "],
        '9' => vec![" █████ ", "█     █", " ██████", "      █", " █████ "],
        ':' => vec!["       ", "   █   ", "       ", "   █   ", "       "],
        '-' => vec!["       ", "       ", "███████", "       ", "       "],
        '_' => vec!["       ", "       ", "       ", "       ", "███████"],
        '!' => vec!["   █   ", "   █   ", "   █   ", "       ", "   █   "],
        '?' => vec![" █████ ", "█     █", "    ██ ", "       ", "   █   "],
        '.' => vec!["       ", "       ", "       ", "       ", "   █   "],
        ',' => vec!["       ", "       ", "       ", "   █   ", "  █    "],
        '\'' => vec!["   █   ", "   █   ", "       ", "       ", "       "],
        ' ' => vec!["       ", "       ", "       ", "       ", "       "],
        _ => vec!["███████", "█     █", "█     █", "█     █", "███████"], // Default box for unknown chars
    };

    for (row, pattern) in patterns.iter().enumerate() {
        for (col, ch) in pattern.chars().enumerate() {
            if ch == '█' {
                // Draw a block for this character
                for dy in 0..char_size {
                    for dx in 0..char_size {
                        let px = x_offset + (col as u32 * char_size) + dx;
                        let py = y_offset + (row as u32 * char_size) + dy;
                        if px < image.width() && py < image.height() {
                            image.put_pixel(px, py, color);
                        }
                    }
                }
            }
        }
    }
}

fn draw_text(image: &mut RgbaImage, text: &str, x: u32, y: u32, char_size: u32, color: Rgba<u8>) {
    let char_width = 7 * char_size; // Each character is 7 units wide
    let char_spacing = char_size; // Space between characters

    for (i, c) in text.chars().enumerate() {
        let char_x = x + (i as u32 * (char_width + char_spacing));
        draw_simple_char(image, c.to_ascii_uppercase(), char_x, y, char_size, color);
    }
}

fn wrap_text(text: &str, max_chars_per_line: usize) -> Vec<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let mut lines = Vec::new();
    let mut current_line = String::new();

    for word in words {
        if current_line.is_empty() {
            current_line = word.to_string();
        } else if current_line.len() + 1 + word.len() <= max_chars_per_line {
            current_line.push(' ');
            current_line.push_str(word);
        } else {
            lines.push(current_line);
            current_line = word.to_string();
        }
    }

    if !current_line.is_empty() {
        lines.push(current_line);
    }

    lines
}

fn display_exit_joke(fb: &mut Framebuffer) -> IoResult<()> {
    let joke = get_random_joke();
    println!("\n🎭 Parting wisdom: {}", joke);

    // Create a black background image
    let mut exit_image = RgbaImage::new(fb.width, fb.height);

    // Fill with black background
    for pixel in exit_image.pixels_mut() {
        *pixel = Rgba([0, 0, 0, 255]);
    }

    // Text rendering settings
    let char_size = 8; // Size multiplier for characters
    let line_height = 5 * char_size + char_size; // 5 rows per char + spacing
    let max_chars_per_line = (fb.width / (7 * char_size + char_size)) as usize; // Account for char width + spacing

    // Wrap the joke text
    let lines = wrap_text(joke, max_chars_per_line);

    // Calculate total text height
    let total_text_height = lines.len() as u32 * line_height;

    // Center the text vertically
    let start_y = (fb.height - total_text_height) / 2;

    // Draw each line of text
    let bright_color = Rgba([255, 255, 0, 255]); // Bright yellow

    for (line_idx, line) in lines.iter().enumerate() {
        // Center each line horizontally
        let text_width = line.len() as u32 * (7 * char_size + char_size);
        let start_x = (fb.width - text_width) / 2;
        let y = start_y + (line_idx as u32 * line_height);

        draw_text(&mut exit_image, line, start_x, y, char_size, bright_color);
    }

    fb.display_image(&exit_image)?;
    println!("Displayed joke on framebuffer: {}", joke);
    
    // Check for second SIGINT during sleep to allow immediate exit
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    
    let interrupted = Arc::new(AtomicBool::new(false));
    let interrupted_clone = interrupted.clone();
    
    // Set up a second signal handler for immediate exit
    let _handle = thread::spawn(move || {
        let mut signals = Signals::new(&[SIGINT, SIGTERM]).unwrap();
        for sig in signals.forever() {
            match sig {
                SIGINT => println!("Second SIGINT received, exiting immediately"),
                SIGTERM => println!("Second SIGTERM received, exiting immediately"),
                _ => println!("Second signal {} received, exiting immediately", sig),
            }
            interrupted_clone.store(true, Ordering::Relaxed);
            std::process::exit(0); // Force immediate exit
        }
    });
    
    // Sleep in small increments, checking for interruption
    for _ in 0..20 { // 20 * 200ms = 4 seconds
        if interrupted.load(Ordering::Relaxed) {
            break;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    
    Ok(())
}

#[tokio::main]
async fn main() -> IoResult<()> {
    let args = Args::parse();
    
    // Generate TV ID if not provided
    let tv_id = args.tv_id.clone().unwrap_or_else(|| {
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(mqtt_client::generate_tv_id())
        })
    });
    
    println!("Raspberry Pi Image Slideshow with MQTT Control");
    println!("TV ID: {}", tv_id);
    println!("Image directory: {}", args.image_dir.display());
    println!("Display duration: {} seconds", args.delay);
    println!("Transition duration: {} ms", args.transition);
    println!("Framebuffer device: {}", args.framebuffer.display());
    println!("MQTT broker: {}", args.mqtt_broker);
    println!("CouchDB server: {}", args.couchdb_url);
    
    if args.enable_mqtt {
        run_with_mqtt_control(args, tv_id).await
    } else {
        run_standalone_mode(args).await
    }
}

async fn run_with_mqtt_control(args: Args, tv_id: String) -> IoResult<()> {
    // Create communication channels
    let (command_sender, command_receiver) = broadcast::channel::<SlideshowCommand>(100);
    let (status_sender, status_receiver) = async_mpsc::channel::<TvStatus>(100);
    
    // Create controller config
    let controller_config = ControllerConfig {
        image_dir: args.image_dir.clone(),
        display_duration: Duration::from_secs(args.delay),
        transition_duration: Duration::from_millis(args.transition),
        couchdb_url: args.couchdb_url.clone(),
        couchdb_username: args.couchdb_username.clone(),
        couchdb_password: args.couchdb_password.clone(),
        tv_id: tv_id.clone(),
        orientation: args.orientation.clone(),
    };
    
    // Initialize slideshow controller
    let mut controller = SlideshowController::new(
        controller_config,
        command_receiver,
        status_sender,
    );
    
    // Try to initialize MQTT client with timeout - but continue if it fails
    match tokio::time::timeout(
        Duration::from_secs(5),
        MqttClient::new(
            &args.mqtt_broker,
            tv_id.clone(),
            command_sender.clone(),
            status_receiver,
        )
    ).await {
        Ok(Ok(mqtt_client)) => {
            println!("Connected to MQTT broker at {}", args.mqtt_broker);
            controller.set_mqtt_client(mqtt_client.clone()).await;
            
            // Start heartbeat publisher only if MQTT connected
            let mut heartbeat_client = mqtt_client.clone();
            tokio::spawn(async move {
                heartbeat_client.run_status_publisher().await;
            });
        }
        Ok(Err(e)) => {
            eprintln!("Warning: Failed to connect to MQTT broker: {}", e);
            println!("Continuing without MQTT remote control");
        }
        Err(_) => {
            eprintln!("Warning: MQTT connection timeout after 5 seconds");
            println!("Continuing without MQTT remote control");
        }
    }
    
    // Initialize controller with timeout
    tokio::time::timeout(
        Duration::from_secs(10),
        controller.initialize()
    ).await.map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "Controller initialization timeout after 10 seconds"))?
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    
    // Start command handler
    let mut controller_clone = controller.clone();
    tokio::spawn(async move {
        controller_clone.run_command_handler().await;
    });
    
    // Start periodic tasks
    let controller_clone = controller.clone();
    tokio::spawn(async move {
        controller_clone.run_periodic_tasks().await;
    });
    
    // Start HTTP server for local control
    let http_controller = controller.clone();
    let http_command_sender = command_sender.clone();
    let http_port = args.http_port;
    tokio::spawn(async move {
        http_server::run_http_server(http_port, http_controller, http_command_sender).await;
    });
    
    // Run main slideshow loop
    run_slideshow_loop(args, controller).await
}

async fn run_standalone_mode(args: Args) -> IoResult<()> {
    println!("Running in standalone mode (no MQTT control)");
    
    // Convert to legacy config and run original slideshow
    let config = Config {
        image_dir: args.image_dir,
        display_duration: Duration::from_secs(args.delay),
        transition_duration: Duration::from_millis(args.transition),
        framebuffer_path: args.framebuffer,
        orientation: Orientation::from(args.orientation.as_str()),
    };
    
    run_original_slideshow(config)
}

async fn run_slideshow_loop(args: Args, controller: SlideshowController) -> IoResult<()> {
    // Get initial orientation from controller (which may be updated from CouchDB)
    let orientation_str = controller.get_orientation().await;
    let mut current_orientation = Orientation::from(orientation_str.as_str());
    
    // IMPORTANT: The framebuffer hardware is likely still in landscape mode (1920x1080)
    // We need to use the actual framebuffer dimensions, not the logical orientation
    let (width, height) = (DEFAULT_LANDSCAPE_WIDTH, DEFAULT_LANDSCAPE_HEIGHT); // Always use landscape framebuffer dimensions
    let mut fb = Framebuffer::new(width, height, &args.framebuffer)?;
    let _image_manager = ImageManager::new();
    
    // Setup event handling for filesystem and signals
    let (tx, rx): (Sender<SlideshowEvent>, Receiver<SlideshowEvent>) = mpsc::channel();
    let _watcher = setup_filesystem_watcher(tx.clone(), &args.image_dir)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    let _signal_handle = setup_signal_handler(tx);
    
    let mut last_image_change = Instant::now();
    let mut running = true;
    let mut has_displayed_placeholder = false;
    let mut last_image_count = controller.get_image_count().await;
    
    // Initial display check - show placeholder immediately if no images
    if controller.get_image_count().await == 0 {
        let tv_id = controller.get_tv_id().await;
        let local_ip = get_local_ip().unwrap_or_else(|| "Unknown IP".to_string());
        let mut placeholder = create_info_placeholder(&tv_id, &local_ip, fb.width, fb.height);
        
        // If we're in portrait mode, rotate the placeholder too
        if matches!(current_orientation, Orientation::Portrait) {
            placeholder = image::imageops::rotate90(&placeholder);
        }
        
        let _ = fb.display_image(&placeholder);
        has_displayed_placeholder = true;
        println!("Displayed 'No images available' placeholder on startup");
    }
    
    while running {
        // Check if orientation has changed (due to MQTT config update)
        let orientation_str = controller.get_orientation().await;
        let new_orientation = Orientation::from(orientation_str.as_str());
        if std::mem::discriminant(&current_orientation) != std::mem::discriminant(&new_orientation) {
            println!("🔄 DISPLAY ORIENTATION CHANGE: {} -> {:?}, forcing immediate redraw", current_orientation as u8, new_orientation);
            current_orientation = new_orientation;
            // Force a redraw by resetting the last image change time
            last_image_change = Instant::now() - Duration::from_secs(10);
            has_displayed_placeholder = false; // Force placeholder redraw if needed
        }
        
        // Check if image count has changed (due to CouchDB sync, etc)
        let current_image_count = controller.get_image_count().await;
        if current_image_count != last_image_count {
            println!("Image count changed from {} to {}, resetting placeholder flag", last_image_count, current_image_count);
            has_displayed_placeholder = false;
            last_image_count = current_image_count;
        }
        
        // Check if we should advance automatically based on controller state
        if controller.should_advance_automatically(last_image_change).await {
            controller.advance_to_next_image().await;
            last_image_change = Instant::now();
            controller.publish_current_image_to_mqtt().await;
        }
        
        // Get current image from controller
        if let Some(current_image_path) = controller.get_current_image_path().await {
            if controller.is_playing().await {
                // Load and display the current image
                // Always load for the actual framebuffer dimensions (landscape)
                match load_and_scale_image_for_framebuffer(&current_image_path, fb.width, fb.height, &current_orientation) {
                    Ok(image) => {
                        if let Err(e) = fb.display_image(&image) {
                            eprintln!("Failed to display image: {}", e);
                        }
                    }
                    Err(e) => {
                        eprintln!("Failed to load image {}: {}", current_image_path.display(), e);
                    }
                }
            }
        } else if controller.get_image_count().await == 0 {
            // No images available, show a placeholder with TV ID and IP
            // Always show placeholder when transitioning from images to no images
            if !has_displayed_placeholder {
                let tv_id = controller.get_tv_id().await;
                let local_ip = get_local_ip().unwrap_or_else(|| "Unknown IP".to_string());
                let mut placeholder = create_info_placeholder(&tv_id, &local_ip, fb.width, fb.height);
                
                // If we're in portrait mode, rotate the placeholder too
                if matches!(current_orientation, Orientation::Portrait) {
                    placeholder = image::imageops::rotate90(&placeholder);
                }
                
                let _ = fb.display_image(&placeholder);
                has_displayed_placeholder = true;
                println!("Displayed 'No images available' placeholder");
            }
        } else {
            // Reset placeholder flag when images become available
            // This ensures placeholder will be shown again if images are later removed
            if has_displayed_placeholder {
                has_displayed_placeholder = false;
                println!("Images now available, clearing placeholder flag");
            }
        }
        
        // Handle filesystem events
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(SlideshowEvent::NewImage(_)) => {
                // Controller will handle image updates via MQTT from management server
            }
            Ok(SlideshowEvent::Shutdown) => {
                running = false;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                running = false;
            }
        }
        
        // Small delay to prevent busy waiting
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    
    println!("Slideshow ended");
    if let Err(e) = display_exit_joke(&mut fb) {
        println!("Failed to display exit joke: {}", e);
    }
    
    Ok(())
}

fn _create_placeholder_image(message: &str, width: u32, height: u32) -> RgbaImage {
    let mut image = RgbaImage::new(width, height);
    
    // Fill with black background
    for pixel in image.pixels_mut() {
        *pixel = Rgba([0, 0, 0, 255]);
    }
    
    // Add text
    let char_size = 8;
    let text_width = message.len() as u32 * (7 * char_size + char_size);
    let start_x = (width - text_width) / 2;
    let start_y = (height - 5 * char_size) / 2;
    
    draw_text(&mut image, message, start_x, start_y, char_size, Rgba([255, 255, 255, 255]));
    
    image
}

fn create_info_placeholder(tv_id: &str, ip_address: &str, width: u32, height: u32) -> RgbaImage {
    let mut image = RgbaImage::new(width, height);
    
    // Fill with dark blue background
    for pixel in image.pixels_mut() {
        *pixel = Rgba([25, 25, 50, 255]);
    }
    
    let char_size = 8;
    let line_height = char_size * 7; // Slightly tighter spacing
    let center_x = width / 2;
    let center_y = height / 2;
    
    // Title - establish maximum width
    let title = "NO IMAGES AVAILABLE";
    let title_width = title.len() as u32 * (7 * char_size + char_size);
    let max_chars_for_title_width = title.len();
    draw_text(&mut image, title, center_x - title_width / 2, center_y - line_height * 3, char_size, Rgba([255, 255, 255, 255]));
    
    // TV ID - wrap if longer than title
    let tv_line = format!("TV ID: {}", tv_id);
    if tv_line.len() <= max_chars_for_title_width {
        let tv_width = tv_line.len() as u32 * (7 * char_size + char_size);
        draw_text(&mut image, &tv_line, center_x - tv_width / 2, center_y - line_height, char_size, Rgba([255, 255, 0, 255]));
    } else {
        let tv_lines = wrap_text(&tv_line, max_chars_for_title_width);
        for (i, line) in tv_lines.iter().enumerate() {
            let line_width = line.len() as u32 * (7 * char_size + char_size);
            let y_pos = center_y - line_height + (i as u32 * (5 * char_size + char_size));
            draw_text(&mut image, line, center_x - line_width / 2, y_pos, char_size, Rgba([255, 255, 0, 255]));
        }
    }
    
    // IP Address - wrap if longer than title  
    let ip_line = format!("IP: {}", ip_address);
    if ip_line.len() <= max_chars_for_title_width {
        let ip_width = ip_line.len() as u32 * (7 * char_size + char_size);
        draw_text(&mut image, &ip_line, center_x - ip_width / 2, center_y, char_size, Rgba([0, 255, 255, 255]));
    } else {
        let ip_lines = wrap_text(&ip_line, max_chars_for_title_width);
        for (i, line) in ip_lines.iter().enumerate() {
            let line_width = line.len() as u32 * (7 * char_size + char_size);
            let y_pos = center_y + (i as u32 * (5 * char_size + char_size));
            draw_text(&mut image, line, center_x - line_width / 2, y_pos, char_size, Rgba([0, 255, 255, 255]));
        }
    }
    
    // Instructions - wrapped text using title width as constraint
    let instruction_char_size = char_size - 1;
    let max_chars_for_instruction = (title_width / (7 * instruction_char_size + instruction_char_size)) as usize;
    let instruction = "Contact staff to assign images to this display";
    let instruction_lines = wrap_text(instruction, max_chars_for_instruction);
    
    let _total_instruction_height = instruction_lines.len() as u32 * (5 * instruction_char_size + instruction_char_size);
    let instruction_start_y = center_y + line_height * 2;
    
    for (line_idx, line) in instruction_lines.iter().enumerate() {
        let line_width = line.len() as u32 * (7 * instruction_char_size + instruction_char_size);
        let line_x = center_x - line_width / 2;
        let line_y = instruction_start_y + (line_idx as u32 * (5 * instruction_char_size + instruction_char_size));
        draw_text(&mut image, line, line_x, line_y, instruction_char_size, Rgba([200, 200, 200, 255]));
    }
    
    image
}

fn load_and_scale_image_for_framebuffer(path: &PathBuf, fb_width: u32, fb_height: u32, orientation: &Orientation) -> Result<RgbaImage, ImageError> {
    println!("Loading image for framebuffer: {}", path.display());
    let img = image::open(path).map_err(|e| {
        eprintln!("Failed to load image {}: {}", path.display(), e);
        e
    })?;
    println!("Successfully loaded image format: {:?}", img.color());
    let mut original_img = img.to_rgba8();
    
    // Processing image for display
    
    // For portrait orientation, we need to compose the image as if it's portrait, then rotate it to fit landscape framebuffer
    if matches!(orientation, Orientation::Portrait) {
        // Step 1: Rotate the source image if needed for portrait viewing
        let image_is_landscape = original_img.width() > original_img.height();
        if image_is_landscape {
            println!("Rotating source landscape image 90° clockwise for portrait composition");
            original_img = image::imageops::rotate90(&original_img);
        }
        
        // Step 2: Scale for portrait dimensions (height > width)
        let portrait_width = fb_height; // Swap dimensions for portrait
        let portrait_height = fb_width;
        
        let scaled_img = scale_image_to_fit(&original_img, portrait_width, portrait_height);
        
        // Step 3: Rotate the final composed image 90° clockwise to fit landscape framebuffer
        // Rotating final portrait composition for landscape framebuffer
        Ok(image::imageops::rotate90(&scaled_img))
    } else {
        // Landscape mode - process normally
        Ok(scale_image_to_fit(&original_img, fb_width, fb_height))
    }
}

fn scale_image_to_fit(original_img: &RgbaImage, target_width: u32, target_height: u32) -> RgbaImage {
    // Calculate scaling factor to fit within target dimensions while preserving aspect ratio
    let original_width = original_img.width() as f32;
    let original_height = original_img.height() as f32;
    let target_width_f = target_width as f32;
    let target_height_f = target_height as f32;
    
    let scale_x = target_width_f / original_width;
    let scale_y = target_height_f / original_height;
    let scale = scale_x.min(scale_y); // Use smaller scale to fit within bounds
    
    let scaled_width = (original_width * scale) as u32;
    let scaled_height = (original_height * scale) as u32;
    
    // Scaling image to fit target dimensions
    
    // Scale the image while preserving aspect ratio
    let scaled_img = image::imageops::resize(
        original_img,
        scaled_width,
        scaled_height,
        image::imageops::FilterType::Lanczos3,
    );
    
    // Create a black background image at target resolution
    let mut result = RgbaImage::new(target_width, target_height);
    for pixel in result.pixels_mut() {
        *pixel = Rgba([0, 0, 0, 255]); // Black background
    }
    
    // Center the scaled image on the black background
    let x_offset = (target_width - scaled_width) / 2;
    let y_offset = (target_height - scaled_height) / 2;
    
    // Copy the scaled image to the center of the result
    for y in 0..scaled_height {
        for x in 0..scaled_width {
            let pixel = *scaled_img.get_pixel(x, y);
            result.put_pixel(x + x_offset, y + y_offset, pixel);
        }
    }
    
    result
}

fn load_and_scale_image_with_orientation(path: &PathBuf, width: u32, height: u32, orientation: &Orientation) -> Result<RgbaImage, ImageError> {
    println!("Loading image with orientation: {}", path.display());
    let img = image::open(path).map_err(|e| {
        eprintln!("Failed to load image {}: {}", path.display(), e);
        e
    })?;
    println!("Successfully loaded image format: {:?}", img.color());
    let mut original_img = img.to_rgba8();
    
    // Processing image for display orientation
    
    // Determine if we need to rotate for the display orientation
    let display_is_portrait = matches!(orientation, Orientation::Portrait);
    let image_is_landscape = original_img.width() > original_img.height();
    
    // Only rotate landscape images for portrait displays
    if display_is_portrait && image_is_landscape {
        println!("Rotating landscape image 90° clockwise for portrait display");
        original_img = image::imageops::rotate90(&original_img);
        println!("After rotation: {}x{}", original_img.width(), original_img.height());
    } else {
        println!("No rotation needed");
    }
    
    // Calculate scaling factor to fit within target dimensions while preserving aspect ratio
    let original_width = original_img.width() as f32;
    let original_height = original_img.height() as f32;
    let target_width = width as f32;
    let target_height = height as f32;
    
    let scale_x = target_width / original_width;
    let scale_y = target_height / original_height;
    let scale = scale_x.min(scale_y); // Use smaller scale to fit within bounds
    
    let scaled_width = (original_width * scale) as u32;
    let scaled_height = (original_height * scale) as u32;
    
    // Scale the image while preserving aspect ratio
    let scaled_img = image::imageops::resize(
        &original_img,
        scaled_width,
        scaled_height,
        image::imageops::FilterType::Lanczos3,
    );
    
    // Create a black background image at target resolution
    let mut result = RgbaImage::new(width, height);
    for pixel in result.pixels_mut() {
        *pixel = Rgba([0, 0, 0, 255]); // Black background
    }
    
    // Center the scaled image on the black background
    let x_offset = (width - scaled_width) / 2;
    let y_offset = (height - scaled_height) / 2;
    
    // Copy the scaled image to the center of the result
    for y in 0..scaled_height {
        for x in 0..scaled_width {
            let pixel = *scaled_img.get_pixel(x, y);
            result.put_pixel(x + x_offset, y + y_offset, pixel);
        }
    }
    
    Ok(result)
}

fn get_local_ip() -> Option<String> {
    use std::net::TcpStream;
    
    // Try to connect to a remote address to determine local IP
    if let Ok(stream) = TcpStream::connect("8.8.8.8:80") {
        if let Ok(local_addr) = stream.local_addr() {
            return Some(local_addr.ip().to_string());
        }
    }
    
    // Fallback: try to get IP from network interfaces
    use std::process::Command;
    if let Ok(output) = Command::new("hostname").arg("-I").output() {
        if let Ok(ip_str) = String::from_utf8(output.stdout) {
            if let Some(ip) = ip_str.split_whitespace().next() {
                return Some(ip.to_string());
            }
        }
    }
    
    None
}

fn run_original_slideshow(config: Config) -> IoResult<()> {

    let (width, height) = config.orientation.dimensions();
    let mut fb = Framebuffer::new(width, height, &config.framebuffer_path)?;
    let mut image_manager = ImageManager::new();

    // Initial image scan
    image_manager.scan_images(&config.image_dir)?;

    if image_manager.images.is_empty() {
        println!("No images (PNG/JPG/JPEG) found in directory: {}", config.image_dir.display());
        return Ok(());
    }

    // Setup event handling
    let (tx, rx): (Sender<SlideshowEvent>, Receiver<SlideshowEvent>) = mpsc::channel();

    let _watcher = setup_filesystem_watcher(tx.clone(), &config.image_dir)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    let _signal_handle = setup_signal_handler(tx);

    // No need to precompute transitions - they're generated in real-time
    println!("Ready for real-time transitions...");

    // Main slideshow loop
    let mut running = true;
    let mut pending_image_idx: Option<usize> = None;

    while running && !image_manager.images.is_empty() {
        let current_idx = image_manager.current_index;
        let current_image_path = image_manager.images[current_idx].clone();

        println!("Displaying: {}", current_image_path.display());

        // Load and display current image
        let current_image = image_manager
            .load_and_scale_image(&current_image_path, fb.width, fb.height)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

        println!(
            "Loaded image {}x{} from {}",
            current_image.width(),
            current_image.height(),
            current_image_path.display()
        );
        fb.display_image(&current_image)?;
        println!("Displayed image on framebuffer");

        let display_start = Instant::now();

        // Display for configured duration while handling events
        while display_start.elapsed() < config.display_duration && running {
            // Check for events with timeout
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(SlideshowEvent::NewImage(new_path)) => {
                    println!("New image detected: {}", new_path.display());
                    if let Some(idx) = image_manager.add_new_image(new_path) {
                        pending_image_idx = Some(idx);
                    }
                }
                Ok(SlideshowEvent::Shutdown) => {
                    running = false;
                    break;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    running = false;
                    break;
                }
            }

            // No precomputation needed for real-time transitions
        }

        if !running {
            break;
        }

        // Find current image index after potential sorting (due to new images being added)
        let actual_current_idx = image_manager
            .images
            .iter()
            .position(|p| *p == current_image_path)
            .unwrap_or(image_manager.current_index);

        // Determine next image - if new image pending, transition to it, otherwise continue sequentially
        let next_idx = if let Some(idx) = pending_image_idx {
            // Transition to the newly added image
            pending_image_idx = None; // Reset the pending flag
            idx
        } else {
            // Continue sequential progression from the actual current position
            if actual_current_idx + 1 < image_manager.images.len() {
                actual_current_idx + 1
            } else {
                0
            }
        };

        // No need to wait - transitions are generated in real-time

        // Play transition from the current image to next
        if let Err(e) = image_manager.play_transition(actual_current_idx, next_idx, &mut fb, config.transition_duration) {
            println!("Failed to play transition: {}", e);
        }

        // Update current index
        image_manager.current_index = next_idx;
    }

    println!("Slideshow ended");

    // Display random joke before exiting
    if let Err(e) = display_exit_joke(&mut fb) {
        println!("Failed to display exit joke: {}", e);
    }

    Ok(())
}
