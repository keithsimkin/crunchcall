use std::io::{self, BufRead, Write};

use crunchcall_engine::Engine;

mod mcp;

fn main() {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() == Some("mcp") {
        std::process::exit(mcp::serve());
    }
    let engine = match Engine::open_default() {
        Ok(engine) => engine,
        Err(err) => {
            eprintln!("crunchcalld: {}", err.message);
            std::process::exit(1);
        }
    };

    let stdin = io::stdin();
    let mut stdout = io::stdout();
    for line in stdin.lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(err) => {
                eprintln!("crunchcalld: {err}");
                break;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let response = engine.handle_line(&line);
        if writeln!(stdout, "{response}").is_err() {
            break;
        }
        if stdout.flush().is_err() {
            break;
        }
    }
}
