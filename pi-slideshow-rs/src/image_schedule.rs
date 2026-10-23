use chrono::{DateTime, Datelike, FixedOffset, NaiveTime};
use serde::{Deserialize, Serialize};

/// When an image may be shown, set per image in the management server.
/// Every part is optional; an empty schedule means "always".
/// Times of day and weekdays are evaluated in the Pi's local time zone.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ImageSchedule {
    /// RFC 3339 instant the image starts showing
    #[serde(default)]
    pub start_time: Option<String>,
    /// RFC 3339 instant the image stops showing
    #[serde(default)]
    pub end_time: Option<String>,
    /// Allowed weekdays, 0 = Sunday (JavaScript getDay numbering); empty = every day
    #[serde(default)]
    pub days_of_week: Vec<u32>,
    /// "HH:MM" daily window; a start later than the end wraps past midnight
    #[serde(default)]
    pub daily_start: Option<String>,
    #[serde(default)]
    pub daily_end: Option<String>,
}

impl ImageSchedule {
    pub fn is_active_at(&self, now: &DateTime<FixedOffset>) -> bool {
        // Unparseable values are ignored rather than hiding the image forever
        if let Some(start) = parse_instant(&self.start_time) {
            if *now < start {
                return false;
            }
        }
        if let Some(end) = parse_instant(&self.end_time) {
            if *now >= end {
                return false;
            }
        }
        if !self.days_of_week.is_empty()
            && !self.days_of_week.contains(&now.weekday().num_days_from_sunday())
        {
            return false;
        }

        let time = now.time();
        match (parse_time(&self.daily_start), parse_time(&self.daily_end)) {
            (Some(start), Some(end)) if start <= end => time >= start && time < end,
            (Some(start), Some(end)) => time >= start || time < end,
            (Some(start), None) => time >= start,
            (None, Some(end)) => time < end,
            (None, None) => true,
        }
    }
}

fn parse_instant(value: &Option<String>) -> Option<DateTime<FixedOffset>> {
    value.as_deref().and_then(|v| DateTime::parse_from_rfc3339(v).ok())
}

fn parse_time(value: &Option<String>) -> Option<NaiveTime> {
    value.as_deref().and_then(|v| NaiveTime::parse_from_str(v, "%H:%M").ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Thursday 2026-10-22 in Mountain Daylight Time
    fn at(time: &str) -> DateTime<FixedOffset> {
        DateTime::parse_from_rfc3339(&format!("2026-10-22T{}:00-06:00", time)).unwrap()
    }

    fn window(start: &str, end: &str) -> ImageSchedule {
        ImageSchedule {
            daily_start: Some(start.into()),
            daily_end: Some(end.into()),
            ..Default::default()
        }
    }

    #[test]
    fn empty_schedule_is_always_active() {
        assert!(ImageSchedule::default().is_active_at(&at("03:00")));
    }

    #[test]
    fn date_range_bounds() {
        let schedule = ImageSchedule {
            start_time: Some("2026-10-22T14:00:00Z".into()), // 08:00 MDT
            end_time: Some("2026-10-22T23:00:00Z".into()),   // 17:00 MDT
            ..Default::default()
        };
        assert!(!schedule.is_active_at(&at("07:59")));
        assert!(schedule.is_active_at(&at("08:00")));
        assert!(schedule.is_active_at(&at("16:59")));
        assert!(!schedule.is_active_at(&at("17:00")));
    }

    #[test]
    fn days_of_week_use_sunday_zero() {
        let weekdays = ImageSchedule { days_of_week: vec![1, 2, 3, 4, 5], ..Default::default() };
        let weekend = ImageSchedule { days_of_week: vec![0, 6], ..Default::default() };
        assert!(weekdays.is_active_at(&at("12:00"))); // Thursday = 4
        assert!(!weekend.is_active_at(&at("12:00")));
    }

    #[test]
    fn daily_window() {
        let schedule = window("08:00", "17:00");
        assert!(!schedule.is_active_at(&at("07:59")));
        assert!(schedule.is_active_at(&at("08:00")));
        assert!(!schedule.is_active_at(&at("17:00")));
    }

    #[test]
    fn daily_window_wraps_midnight() {
        let schedule = window("22:00", "06:00");
        assert!(schedule.is_active_at(&at("23:30")));
        assert!(schedule.is_active_at(&at("05:59")));
        assert!(!schedule.is_active_at(&at("12:00")));
    }

    #[test]
    fn invalid_values_are_ignored() {
        let schedule = ImageSchedule {
            start_time: Some("not a date".into()),
            daily_start: Some("25:99".into()),
            ..Default::default()
        };
        assert!(schedule.is_active_at(&at("12:00")));
    }
}
