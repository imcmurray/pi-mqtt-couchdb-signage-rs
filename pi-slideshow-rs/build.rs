use std::process::Command;

fn main() {
    // Get git commit hash
    let commit_hash = Command::new("git")
        .args(&["rev-parse", "HEAD"])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    // Get short commit hash (first 7 characters)
    let short_hash = if commit_hash.len() >= 7 {
        &commit_hash[0..7]
    } else {
        &commit_hash
    };

    // Get git branch name
    let branch = Command::new("git")
        .args(&["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_else(|_| "unknown".to_string());

    // Get build timestamp
    let build_time = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S UTC").to_string();

    // Set environment variables for the build
    println!("cargo:rustc-env=GIT_COMMIT_HASH={}", commit_hash);
    println!("cargo:rustc-env=GIT_COMMIT_SHORT={}", short_hash);
    println!("cargo:rustc-env=GIT_BRANCH={}", branch);
    println!("cargo:rustc-env=BUILD_TIME={}", build_time);

    // Tell cargo to rerun if git HEAD changes
    println!("cargo:rerun-if-changed=.git/HEAD");
    println!("cargo:rerun-if-changed=.git/refs/heads");
}