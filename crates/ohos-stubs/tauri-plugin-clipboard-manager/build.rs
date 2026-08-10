fn main() {
    tauri_plugin::Builder::new(&["write_text", "read_text", "clear"]).build();
}
