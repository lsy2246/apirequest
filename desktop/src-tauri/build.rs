fn main() {
    // Tauri embeds icon bytes in development binaries as well as bundle resources.
    // Track the originals so changing an icon also refreshes the running app icon.
    println!("cargo:rerun-if-changed=icons/icon.icns");
    println!("cargo:rerun-if-changed=icons/icon.png");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
