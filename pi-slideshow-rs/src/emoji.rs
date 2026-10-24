//! Colour emoji in layer text, drawn from the bundled Noto Color Emoji font
//! (`public/fonts/NotoColorEmoji.ttf`, embedded at build time so TVs need nothing
//! installed). Its glyphs are PNG bitmaps (CBDT), which fontdue can't draw, so
//! text is split into pieces: characters for the text font, emoji drawn here.
//! There is no shaping: multi-part emoji (ZWJ families, flags) show as their parts.

use image::{imageops, Rgba, RgbaImage};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use ttf_parser::{Face, RasterImageFormat};

static FONT: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../public/fonts/NotoColorEmoji.ttf"));

fn face() -> Option<&'static Face<'static>> {
    static FACE: OnceLock<Option<Face<'static>>> = OnceLock::new();
    FACE.get_or_init(|| Face::parse(FONT, 0).map_err(|e| eprintln!("Emoji font unusable: {}", e)).ok())
        .as_ref()
}

/// A piece of text: a character for the text font, or an emoji
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Piece {
    Char(char),
    Emoji(char),
}

/// Joiners, presentation selectors, keycap marks and skin tones aren't drawn
fn invisible(ch: char) -> bool {
    matches!(ch as u32, 0x200D | 0xFE0E | 0xFE0F | 0x20E3 | 0x1F3FB..=0x1F3FF | 0xE0020..=0xE007F)
}

/// Characters below U+1F000 that show as emoji even without U+FE0F
/// (Unicode Emoji_Presentation=Yes)
fn default_emoji(ch: char) -> bool {
    matches!(ch as u32,
        0x231A..=0x231B | 0x23E9..=0x23EC | 0x23F0 | 0x23F3 | 0x25FD..=0x25FE | 0x2614..=0x2615
        | 0x2648..=0x2653 | 0x267F | 0x2693 | 0x26A1 | 0x26AA..=0x26AB | 0x26BD..=0x26BE
        | 0x26C4..=0x26C5 | 0x26CE | 0x26D4 | 0x26EA | 0x26F2..=0x26F3 | 0x26F5 | 0x26FA | 0x26FD
        | 0x2705 | 0x270A..=0x270B | 0x2728 | 0x274C | 0x274E | 0x2753..=0x2755 | 0x2757
        | 0x2795..=0x2797 | 0x27B0 | 0x27BF | 0x2B1B..=0x2B1C | 0x2B50 | 0x2B55)
}

fn has_glyph(ch: char) -> bool {
    face().and_then(|f| f.glyph_index(ch)).is_some()
}

/// Split text into what the text font draws and what the emoji font draws.
/// Plain ASCII (digits, #, *) always stays text.
pub fn pieces(text: &str) -> Vec<Piece> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::with_capacity(chars.len());
    for (i, &ch) in chars.iter().enumerate() {
        if invisible(ch) {
            continue;
        }
        let next = chars.get(i + 1).copied();
        let emoji = !ch.is_ascii()
            && next != Some('\u{FE0E}')
            && (ch as u32 >= 0x1F000 || next == Some('\u{FE0F}') || default_emoji(ch))
            && has_glyph(ch);
        out.push(if emoji { Piece::Emoji(ch) } else { Piece::Char(ch) });
    }
    out
}

/// Horizontal space an emoji takes in a line of `size` px text
pub fn advance(ch: char, size: f32) -> f32 {
    face()
        .and_then(|f| {
            let advance = f.glyph_hor_advance(f.glyph_index(ch)?)?;
            Some(advance as f32 * size / f.units_per_em() as f32)
        })
        .unwrap_or(size)
}

/// An emoji scaled for one text size. `left` / `top` place it relative to the
/// pen position and the baseline (top is negative: above the baseline).
pub struct Glyph {
    pub image: RgbaImage,
    pub left: i32,
    pub top: i32,
}

/// The emoji at `size` px; cached, since the same few are drawn every frame
pub fn glyph(ch: char, size: f32) -> Option<Arc<Glyph>> {
    static CACHE: OnceLock<Mutex<HashMap<(char, u32), Option<Arc<Glyph>>>>> = OnceLock::new();
    let px = size.round().max(1.0) as u32;
    let cache = CACHE.get_or_init(Default::default);
    if let Some(hit) = cache.lock().unwrap().get(&(ch, px)) {
        return hit.clone();
    }
    let made = render(ch, px).map(Arc::new);
    let mut cache = cache.lock().unwrap();
    if cache.len() > 1024 {
        cache.clear();
    }
    cache.insert((ch, px), made.clone());
    made
}

fn render(ch: char, px: u32) -> Option<Glyph> {
    let face = face()?;
    let raster = face.glyph_raster_image(face.glyph_index(ch)?, u16::MAX)?;
    if raster.format != RasterImageFormat::PNG {
        return None;
    }
    let image = image::load_from_memory_with_format(raster.data, image::ImageFormat::Png).ok()?.to_rgba8();
    let scale = px as f32 / raster.pixels_per_em as f32;
    let width = ((raster.width as f32 * scale).round() as u32).max(1);
    let height = ((raster.height as f32 * scale).round() as u32).max(1);
    Some(Glyph {
        image: imageops::resize(&image, width, height, imageops::FilterType::CatmullRom),
        left: (raster.x as f32 * scale).round() as i32,
        top: -((raster.y as f32 + raster.height as f32) * scale).round() as i32,
    })
}

/// Draw an emoji at the pen position / baseline, inside clip = (left, top, right, bottom)
#[allow(clippy::too_many_arguments)]
pub fn draw(
    glyph: &Glyph,
    pen_x: f32,
    baseline: f32,
    opacity: f32,
    clip: (i32, i32, i32, i32),
    target: &mut RgbaImage,
    blend: impl Fn(Rgba<u8>, Rgba<u8>) -> Rgba<u8>,
) {
    let (left, top, right, bottom) = (
        clip.0.max(0),
        clip.1.max(0),
        clip.2.min(target.width() as i32),
        clip.3.min(target.height() as i32),
    );
    let x0 = pen_x.round() as i32 + glyph.left;
    let y0 = baseline.round() as i32 + glyph.top;
    for (gx, gy, pixel) in glyph.image.enumerate_pixels() {
        let (px, py) = (x0 + gx as i32, y0 + gy as i32);
        if pixel[3] == 0 || px < left || py < top || px >= right || py >= bottom {
            continue;
        }
        let alpha = (pixel[3] as f32 * opacity) as u8;
        let existing = *target.get_pixel(px as u32, py as u32);
        target.put_pixel(px as u32, py as u32, blend(existing, Rgba([pixel[0], pixel[1], pixel[2], alpha])));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_emoji_from_text() {
        use Piece::*;
        // U+2696 (scales) only shows as emoji with U+FE0F; the selector itself isn't drawn
        assert_eq!(pieces("⚖️ Court 1"), vec![Emoji('⚖'), Char(' '), Char('C'), Char('o'), Char('u'), Char('r'), Char('t'), Char(' '), Char('1')]);
        assert_eq!(pieces("⚖ a"), vec![Char('⚖'), Char(' '), Char('a')]);
        assert_eq!(pieces("👋☕"), vec![Emoji('👋'), Emoji('☕')]);
        // Text presentation selector keeps a default-emoji character as text
        assert_eq!(pieces("☕\u{FE0E}"), vec![Char('☕')]);
        // Digits and punctuation stay text even though the emoji font has them
        assert_eq!(pieces("1#*"), vec![Char('1'), Char('#'), Char('*')]);
        // Skin tones are dropped
        assert_eq!(pieces("👋🏽"), vec![Emoji('👋')]);
    }

    #[test]
    fn renders_colour_bitmaps_at_text_size() {
        let g = glyph('🏛', 64.0).expect("courthouse emoji");
        assert!(g.image.height() >= 64 && g.image.height() <= 90, "height {}", g.image.height());
        assert!(g.top < 0, "sits above the baseline");
        // Colour, not a monochrome mask
        assert!(g.image.pixels().any(|p| p[3] > 0 && (p[0] != p[1] || p[1] != p[2])));
        assert!((advance('🏛', 64.0) - 64.0).abs() < 20.0);
    }
}
