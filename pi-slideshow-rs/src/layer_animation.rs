use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum AnimationType {
    None,
    SlideUp,
    SlideDown,
    SlideLeft,
    SlideRight,
    FadeIn,
    FadeOut,
    Scale,
    Move,
}

impl AnimationType {
    pub fn from_string(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "none" => Some(Self::None),
            "slide_up" | "slideup" => Some(Self::SlideUp),
            "slide_down" | "slidedown" => Some(Self::SlideDown),
            "slide_left" | "slideleft" => Some(Self::SlideLeft),
            "slide_right" | "slideright" => Some(Self::SlideRight),
            "fade_in" | "fadein" => Some(Self::FadeIn),
            "fade_out" | "fadeout" => Some(Self::FadeOut),
            "scale" => Some(Self::Scale),
            "move" => Some(Self::Move),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum EasingFunction {
    Linear,
    EaseIn,
    EaseOut,
    EaseInOut,
    Bounce,
    Elastic,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnimationState {
    pub active: bool,
    pub animation_type: AnimationType,
    #[serde(skip)]
    pub start_time: Option<Instant>,
    pub duration: Duration,
    pub easing: EasingFunction,
    pub progress: f32,
    pub from_value: AnimationValue,
    pub to_value: AnimationValue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AnimationValue {
    Position { x: f32, y: f32 },
    Opacity(f32),
    Scale(f32),
    Combined {
        position: (f32, f32),
        opacity: f32,
        scale: f32,
    },
}

impl Default for AnimationState {
    fn default() -> Self {
        Self {
            active: false,
            animation_type: AnimationType::None,
            start_time: None,
            duration: Duration::from_millis(500),
            easing: EasingFunction::EaseInOut,
            progress: 0.0,
            from_value: AnimationValue::Position { x: 0.0, y: 0.0 },
            to_value: AnimationValue::Position { x: 0.0, y: 0.0 },
        }
    }
}

impl AnimationState {
    pub fn new(
        animation_type: AnimationType,
        duration_ms: u64,
        easing: EasingFunction,
        from: AnimationValue,
        to: AnimationValue,
    ) -> Self {
        Self {
            active: true,
            animation_type,
            start_time: Some(Instant::now()),
            duration: Duration::from_millis(duration_ms),
            easing,
            progress: 0.0,
            from_value: from,
            to_value: to,
        }
    }

    pub fn update(&mut self) -> bool {
        if !self.active || self.start_time.is_none() {
            return false;
        }

        let elapsed = self.start_time.unwrap().elapsed();
        let raw_progress = elapsed.as_millis() as f32 / self.duration.as_millis() as f32;
        self.progress = raw_progress.clamp(0.0, 1.0);

        if self.progress >= 1.0 {
            self.active = false;
            return false;
        }

        true
    }

    pub fn get_eased_progress(&self) -> f32 {
        apply_easing(self.progress, &self.easing)
    }

    pub fn get_current_value(&self) -> AnimationValue {
        let t = self.get_eased_progress();
        
        match (&self.from_value, &self.to_value) {
            (AnimationValue::Position { x: x1, y: y1 }, AnimationValue::Position { x: x2, y: y2 }) => {
                AnimationValue::Position {
                    x: lerp(*x1, *x2, t),
                    y: lerp(*y1, *y2, t),
                }
            }
            (AnimationValue::Opacity(o1), AnimationValue::Opacity(o2)) => {
                AnimationValue::Opacity(lerp(*o1, *o2, t))
            }
            (AnimationValue::Scale(s1), AnimationValue::Scale(s2)) => {
                AnimationValue::Scale(lerp(*s1, *s2, t))
            }
            (
                AnimationValue::Combined { position: (x1, y1), opacity: o1, scale: s1 },
                AnimationValue::Combined { position: (x2, y2), opacity: o2, scale: s2 },
            ) => {
                AnimationValue::Combined {
                    position: (lerp(*x1, *x2, t), lerp(*y1, *y2, t)),
                    opacity: lerp(*o1, *o2, t),
                    scale: lerp(*s1, *s2, t),
                }
            }
            _ => self.from_value.clone(), // Type mismatch, return from value
        }
    }
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

fn apply_easing(t: f32, easing: &EasingFunction) -> f32 {
    match easing {
        EasingFunction::Linear => t,
        EasingFunction::EaseIn => t * t,
        EasingFunction::EaseOut => 1.0 - (1.0 - t) * (1.0 - t),
        EasingFunction::EaseInOut => {
            if t < 0.5 {
                2.0 * t * t
            } else {
                1.0 - 2.0 * (1.0 - t) * (1.0 - t)
            }
        }
        EasingFunction::Bounce => {
            if t < 0.5 {
                0.5 * (1.0 - bounce_out(1.0 - 2.0 * t))
            } else {
                0.5 * bounce_out(2.0 * t - 1.0) + 0.5
            }
        }
        EasingFunction::Elastic => {
            if t == 0.0 || t == 1.0 {
                t
            } else {
                let p = 0.3;
                let s = p / 4.0;
                let post_fix = 2.0_f32.powf(-10.0 * t) * ((t - s) * (2.0 * std::f32::consts::PI) / p).sin();
                post_fix + 1.0
            }
        }
    }
}

fn bounce_out(t: f32) -> f32 {
    if t < 1.0 / 2.75 {
        7.5625 * t * t
    } else if t < 2.0 / 2.75 {
        let t = t - 1.5 / 2.75;
        7.5625 * t * t + 0.75
    } else if t < 2.5 / 2.75 {
        let t = t - 2.25 / 2.75;
        7.5625 * t * t + 0.9375
    } else {
        let t = t - 2.625 / 2.75;
        7.5625 * t * t + 0.984375
    }
}

// Helper functions for creating common animations
impl AnimationState {
    pub fn slide_up(y: f32, distance: f32, duration_ms: u64) -> Self {
        Self::new(
            AnimationType::SlideUp,
            duration_ms,
            EasingFunction::EaseInOut,
            AnimationValue::Position { x: 0.0, y },
            AnimationValue::Position { x: 0.0, y: y - distance },
        )
    }

    pub fn slide_down(y: f32, distance: f32, duration_ms: u64) -> Self {
        Self::new(
            AnimationType::SlideDown,
            duration_ms,
            EasingFunction::EaseInOut,
            AnimationValue::Position { x: 0.0, y },
            AnimationValue::Position { x: 0.0, y: y + distance },
        )
    }

    pub fn slide_left(x: f32, distance: f32, duration_ms: u64) -> Self {
        Self::new(
            AnimationType::SlideLeft,
            duration_ms,
            EasingFunction::EaseInOut,
            AnimationValue::Position { x, y: 0.0 },
            AnimationValue::Position { x: x - distance, y: 0.0 },
        )
    }

    pub fn slide_right(x: f32, distance: f32, duration_ms: u64) -> Self {
        Self::new(
            AnimationType::SlideRight,
            duration_ms,
            EasingFunction::EaseInOut,
            AnimationValue::Position { x, y: 0.0 },
            AnimationValue::Position { x: x + distance, y: 0.0 },
        )
    }

    pub fn fade_in(duration_ms: u64) -> Self {
        Self::new(
            AnimationType::FadeIn,
            duration_ms,
            EasingFunction::EaseIn,
            AnimationValue::Opacity(0.0),
            AnimationValue::Opacity(1.0),
        )
    }

    pub fn fade_out(duration_ms: u64) -> Self {
        Self::new(
            AnimationType::FadeOut,
            duration_ms,
            EasingFunction::EaseOut,
            AnimationValue::Opacity(1.0),
            AnimationValue::Opacity(0.0),
        )
    }

    pub fn move_to(from_x: f32, from_y: f32, to_x: f32, to_y: f32, duration_ms: u64) -> Self {
        Self::new(
            AnimationType::Move,
            duration_ms,
            EasingFunction::EaseInOut,
            AnimationValue::Position { x: from_x, y: from_y },
            AnimationValue::Position { x: to_x, y: to_y },
        )
    }
}