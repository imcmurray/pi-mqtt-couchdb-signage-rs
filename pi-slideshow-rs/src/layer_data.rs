//! Live data in layers: `{token}` values in layer text (clock, date, weather)
//! and table layers drawn from a data set (the court calendar). Data sets are
//! `dataset_<id>` documents in the layers database; the TV fills in the clock
//! itself and pages tables on its own, so both keep working offline.

use chrono::{DateTime, FixedOffset, NaiveDate, NaiveTime};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TableColumn {
    /// Row field to show; `time` and `date` are formatted for display
    pub field: String,
    pub label: String,
    pub width: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TableSpec {
    pub dataset: String,
    /// today | upcoming | all
    pub filter: String,
    pub columns: Vec<TableColumn>,
    pub row_height: u32,
    pub font_size: u32,
    pub header_font_size: u32,
    pub font_family: String,
    pub header_background: String,
    pub header_text_color: String,
    pub row_background: String,
    pub alt_row_background: String,
    pub text_color: String,
    pub page_seconds: u64,
    pub empty_text: String,
    /// Only rows whose `field` equals `value` (case-insensitive), e.g. one
    /// courtroom's or one judge's hearings on the TV outside that courtroom
    #[serde(rename = "match")]
    pub row_match: Option<RowMatch>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RowMatch {
    pub field: String,
    pub value: String,
}

impl Default for TableSpec {
    fn default() -> Self {
        Self {
            dataset: String::new(),
            filter: "today".into(),
            columns: Vec::new(),
            row_height: 70,
            font_size: 28,
            header_font_size: 26,
            font_family: String::new(),
            header_background: "rgba(201, 162, 39, 1)".into(),
            header_text_color: "rgba(15, 23, 42, 1)".into(),
            row_background: "rgba(255, 255, 255, 0.05)".into(),
            alt_row_background: "rgba(255, 255, 255, 0.12)".into(),
            text_color: "rgba(255, 255, 255, 1)".into(),
            page_seconds: 12,
            empty_text: "Nothing scheduled.".into(),
            row_match: None,
        }
    }
}

/// Fill `{token}`s: clock values from `now`, the rest from `values` (e.g. the
/// weather data set). Unknown tokens are left as typed so mistakes are visible.
pub fn expand_tokens(text: &str, now: &DateTime<FixedOffset>, values: &HashMap<String, String>) -> String {
    if !text.contains('{') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('}') {
            Some(end) if after[..end].chars().all(|c| c.is_ascii_alphanumeric() || c == '_') => {
                let name = &after[..end];
                match clock_token(name, now).or_else(|| values.get(name).cloned()) {
                    Some(value) => out.push_str(&value),
                    None => out.push_str(&rest[start..start + end + 2]),
                }
                rest = &after[end + 1..];
            }
            _ => {
                out.push('{');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

fn clock_token(name: &str, now: &DateTime<FixedOffset>) -> Option<String> {
    let format = match name {
        "time" => "%-I:%M %p",
        "time24" => "%H:%M",
        "date" => "%A, %B %-d, %Y",
        "short_date" => "%b %-d",
        "day" => "%A",
        "month" => "%B",
        "year" => "%Y",
        _ => return None,
    };
    Some(now.format(format).to_string())
}

/// True if the text changes with the clock, so it must be redrawn each minute
pub fn uses_clock(text: &str) -> bool {
    ["{time", "{date", "{short_date}", "{day}", "{month}", "{year}"].iter().any(|t| text.contains(t))
}

/// Rows from the data set that this table shows, in data set order
pub fn table_rows<'a>(spec: &TableSpec, rows: &'a [serde_json::Value], today: NaiveDate) -> Vec<&'a serde_json::Value> {
    let wanted = spec.row_match.as_ref()
        .filter(|m| !m.field.is_empty() && !m.value.trim().is_empty())
        .map(|m| (m.field.as_str(), m.value.trim().to_lowercase()));
    rows.iter()
        .filter(|row| {
            let date = row["date"].as_str().and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());
            let in_window = match spec.filter.as_str() {
                "all" => true,
                "upcoming" => date.map_or(true, |d| d >= today),
                _ => date == Some(today),
            };
            in_window && wanted.as_ref().map_or(true, |(field, value)| {
                row[*field].as_str().map_or(false, |v| v.trim().to_lowercase() == *value)
            })
        })
        .collect()
}

/// (rows per page, page count, current page) for a table of the given height
pub fn paging(spec: &TableSpec, height: u32, row_count: usize, unix_seconds: u64) -> (usize, usize, usize) {
    let row_height = spec.row_height.max(20);
    // Header row on top, a short footer strip for the page indicator below
    let body = height.saturating_sub(row_height + row_height / 2);
    let per_page = ((body / row_height) as usize).max(1);
    let pages = row_count.div_ceil(per_page).max(1);
    let page = ((unix_seconds / spec.page_seconds.max(1)) as usize) % pages;
    (per_page, pages, page)
}

/// Display text for one cell
pub fn cell_text(row: &serde_json::Value, field: &str) -> String {
    let raw = match &row[field] {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    };
    match field {
        "time" => NaiveTime::parse_from_str(&raw, "%H:%M")
            .map(|t| t.format("%-I:%M %p").to_string())
            .unwrap_or(raw),
        "date" => NaiveDate::parse_from_str(&raw, "%Y-%m-%d")
            .map(|d| d.format("%a %b %-d").to_string())
            .unwrap_or(raw),
        // "heard" -> "Heard"
        "status" => {
            let mut chars = raw.chars();
            chars.next().map(|c| c.to_uppercase().chain(chars).collect()).unwrap_or_default()
        }
        _ => raw,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn at(s: &str) -> DateTime<FixedOffset> {
        DateTime::parse_from_rfc3339(s).unwrap()
    }

    #[test]
    fn expands_clock_and_data_tokens() {
        let now = at("2026-10-23T14:05:00-06:00");
        let values = HashMap::from([("weather".to_string(), "61°F · Sunny".to_string())]);
        assert_eq!(
            expand_tokens("{day}, {short_date} · {time} · {weather}", &now, &values),
            "Friday, Oct 23 · 2:05 PM · 61°F · Sunny"
        );
        assert_eq!(expand_tokens("{date}", &now, &values), "Friday, October 23, 2026");
    }

    #[test]
    fn leaves_unknown_tokens_and_plain_braces_alone() {
        let now = at("2026-10-23T09:00:00-06:00");
        let values = HashMap::new();
        assert_eq!(expand_tokens("{weather} {nope} a{b c} {", &now, &values), "{weather} {nope} a{b c} {");
        assert_eq!(expand_tokens("no tokens", &now, &values), "no tokens");
    }

    #[test]
    fn detects_clock_text() {
        assert!(uses_clock("{day}, {time}"));
        assert!(!uses_clock("{weather}"));
    }

    #[test]
    fn filters_rows_by_day() {
        let rows = vec![json!({"date": "2026-10-22"}), json!({"date": "2026-10-23"}), json!({"date": "2026-10-24"})];
        let today = NaiveDate::from_ymd_opt(2026, 10, 23).unwrap();
        let spec = |filter: &str| TableSpec { filter: filter.into(), ..Default::default() };
        assert_eq!(table_rows(&spec("today"), &rows, today).len(), 1);
        assert_eq!(table_rows(&spec("upcoming"), &rows, today).len(), 2);
        assert_eq!(table_rows(&spec("all"), &rows, today).len(), 3);
    }

    #[test]
    fn pages_rotate_with_time() {
        let spec = TableSpec { row_height: 76, page_seconds: 12, ..Default::default() };
        // 850px: header 76 + footer 38 leaves 736 -> 9 rows a page
        assert_eq!(paging(&spec, 850, 20, 0), (9, 3, 0));
        assert_eq!(paging(&spec, 850, 20, 12), (9, 3, 1));
        assert_eq!(paging(&spec, 850, 20, 36), (9, 3, 0));
        assert_eq!(paging(&spec, 850, 0, 99), (9, 1, 0));
    }

    #[test]
    fn formats_time_and_date_cells() {
        let row = json!({"time": "13:30", "date": "2026-10-23", "case_number": "26-1", "courtroom": null});
        assert_eq!(cell_text(&row, "time"), "1:30 PM");
        assert_eq!(cell_text(&row, "date"), "Fri Oct 23");
        assert_eq!(cell_text(&row, "case_number"), "26-1");
        assert_eq!(cell_text(&row, "courtroom"), "");
        assert_eq!(cell_text(&row, "missing"), "");
    }

    #[test]
    fn match_limits_rows_to_one_courtroom() {
        let rows = vec![
            json!({"date": "2026-10-23", "courtroom": "North"}),
            json!({"date": "2026-10-23", "courtroom": "south"}),
            json!({"date": "2026-10-23", "courtroom": "South "}),
            json!({"date": "2026-10-24", "courtroom": "South"}),
        ];
        let today = NaiveDate::from_ymd_opt(2026, 10, 23).unwrap();
        let spec: TableSpec = serde_json::from_value(json!({ "match": { "field": "courtroom", "value": "South" } })).unwrap();
        assert_eq!(table_rows(&spec, &rows, today).len(), 2);
        let blank: TableSpec = serde_json::from_value(json!({ "match": { "field": "courtroom", "value": " " } })).unwrap();
        assert_eq!(table_rows(&blank, &rows, today).len(), 3);
    }

    #[test]
    fn status_cells_are_capitalised() {
        assert_eq!(cell_text(&json!({"status": "continued"}), "status"), "Continued");
        assert_eq!(cell_text(&json!({"status": ""}), "status"), "");
    }

    #[test]
    fn table_spec_reads_template_json() {
        let spec: TableSpec = serde_json::from_value(json!({
            "dataset": "court_calendar", "rowHeight": 76, "pageSeconds": 12,
            "columns": [{ "field": "time", "label": "Time", "width": 150 }]
        })).unwrap();
        assert_eq!(spec.dataset, "court_calendar");
        assert_eq!(spec.row_height, 76);
        assert_eq!(spec.columns[0].label, "Time");
        assert_eq!(spec.filter, "today");
    }
}
