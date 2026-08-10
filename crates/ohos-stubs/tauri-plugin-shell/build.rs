fn main() {
    // UI process must NOT link Go libmihomo_core (TLS / reloc fails when Ark loads libapp_lib).
    // Core runs in NativeChildProcess via libmihomo_runner.so instead.
    println!("cargo:rerun-if-changed=build.rs");
}
