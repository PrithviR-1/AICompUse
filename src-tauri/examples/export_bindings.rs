//! Regenerates `src/lib/bindings.ts` from the Rust command definitions.
//! Run with `pnpm bindings` (CI checks that the committed file is up to date).

fn main() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(machi_lib::BINDINGS_PATH);
    match machi_lib::export_bindings(&path) {
        Ok(()) => println!("bindings written to {}", path.display()),
        Err(err) => {
            eprintln!("failed to export bindings: {err}");
            std::process::exit(1);
        }
    }
}
