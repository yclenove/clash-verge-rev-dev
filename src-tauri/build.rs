fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Android + OpenHarmony share the "mobile-like" stubs (no tray/sysproxy/service).
    println!("cargo:rustc-check-cfg=cfg(clash_verge_mobile)");
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = std::env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    if target_os == "android" || target_env == "ohos" {
        println!("cargo:rustc-cfg=clash_verge_mobile");
    }

    let windows_msvc = target_os == "windows" && target_env == "msvc";

    // Tauri already embeds a Common-Controls v6 manifest into the app binary via
    // resource.lib. Unconditionally adding another /MANIFESTINPUT causes:
    //   rust-lld: error: duplicate resource: type MANIFEST ...
    //
    // Unit-test harnesses do NOT get Tauri's resource, so they need their own
    // manifest or they die at startup with STATUS_ENTRYPOINT_NOT_FOUND on
    // comctl32!TaskDialogIndirect.
    //
    // Enable the extra manifest only when:
    // - feature `clippy` (skips tauri_build / mock context), or
    // - env CV_EMBED_TEST_MANIFEST=1 (set by test runners for `cargo test`)
    let embed_test_manifest = windows_msvc
        && (std::env::var_os("CARGO_FEATURE_CLIPPY").is_some() || std::env::var_os("CV_EMBED_TEST_MANIFEST").is_some());

    if embed_test_manifest {
        let out_dir = std::env::var_os("OUT_DIR").ok_or_else(|| std::io::Error::other("OUT_DIR is not set"))?;
        let manifest_path = std::path::PathBuf::from(out_dir).join("windows-test-manifest.xml");
        std::fs::write(
            &manifest_path,
            r#"<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
</assembly>
"#,
        )?;
        let manifest = manifest_path.display();
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{manifest}");
        println!("cargo:rerun-if-env-changed=CV_EMBED_TEST_MANIFEST");
    }

    #[cfg(feature = "clippy")]
    {
        println!("cargo:warning=Skipping tauri_build during Clippy");
    }

    #[cfg(not(feature = "clippy"))]
    tauri_build::build();

    Ok(())
}
