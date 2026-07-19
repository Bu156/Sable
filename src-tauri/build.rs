fn main() {
    println!("cargo:rustc-env=TS_RS_EXPORT_DIR=../src/app/generated/tauri");

    // Find libcef.so next to the binary (CEF ships it there).
    if std::env::var_os("CARGO_FEATURE_CEF").is_some()
        && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux")
    {
        println!("cargo:rustc-link-arg-bins=-Wl,-rpath,$ORIGIN");
    }

    // The notifications plugin links the Swift runtime via @rpath.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg-bins=-Wl,-rpath,/usr/lib/swift");
    }

    tauri_typegen::BuildSystem::generate_at_build_time()
        .expect("Failed to generate TypeScript bindings");

    tauri_build::build()
}
