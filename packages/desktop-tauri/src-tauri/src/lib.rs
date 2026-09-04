#[cfg(not(mobile))]
use std::{
    fs::{create_dir_all, File},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(not(mobile))]
#[derive(Default)]
struct DesktopHostProcess {
    child: Mutex<Option<Child>>,
}

#[cfg(not(mobile))]
struct SessionToken(String);

#[cfg(not(mobile))]
impl DesktopHostProcess {
    fn set(&self, child: Child) {
        if let Ok(mut current) = self.child.lock() {
            *current = Some(child);
        }
    }

    fn kill(&self) {
        if let Ok(mut child) = self.child.lock() {
            if let Some(mut child) = child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[cfg(not(mobile))]
impl Drop for DesktopHostProcess {
    fn drop(&mut self) {
        self.kill();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(not(mobile))]
    let builder = builder
        .manage(DesktopHostProcess::default())
        .manage(SessionToken(generate_session_token()))
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                use tauri::Manager;
                window.app_handle().state::<DesktopHostProcess>().kill();
            }
        });

    builder
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![romdeck_session_token])
        .setup(|app| {
            #[cfg(not(mobile))]
            start_desktop_host(app);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build RomDeck desktop shell")
        .run(|app_handle, event| {
            #[cfg(not(mobile))]
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                use tauri::Manager;
                app_handle.state::<DesktopHostProcess>().kill();
            }
        });
}

#[cfg(not(mobile))]
#[tauri::command]
fn romdeck_session_token(token: tauri::State<SessionToken>) -> String {
    token.0.clone()
}

#[cfg(mobile)]
#[tauri::command]
fn romdeck_session_token() -> String {
    String::new()
}

#[cfg(not(mobile))]
fn start_desktop_host(app: &mut tauri::App) {
    use tauri::{path::BaseDirectory, Manager};

    let server_dir = match app
        .path()
        .resolve("host/desktop-host/dist", BaseDirectory::Resource)
    {
        Ok(path) => path,
        Err(error) => {
            eprintln!("RomDeck host resource not found: {error}");
            return;
        }
    };

    let node_path = node_executable(app);
    let session_token = app.state::<SessionToken>().0.clone();
    let mut command = Command::new(&node_path);
    command.arg("server.js")
        .env("PORT", "5137")
        .env("ROMDECK_SESSION_TOKEN", session_token)
        .current_dir(server_dir)
        .stdin(Stdio::null());

    if let Some(log_file) = host_log_file() {
        match File::create(&log_file) {
            Ok(stdout) => match stdout.try_clone() {
                Ok(stderr) => {
                    command.stdout(Stdio::from(stdout)).stderr(Stdio::from(stderr));
                }
                Err(_) => {
                    command.stdout(Stdio::from(stdout)).stderr(Stdio::null());
                }
            },
            Err(_) => {
                command.stdout(Stdio::null()).stderr(Stdio::null());
            }
        }
    } else {
        command.stdout(Stdio::null()).stderr(Stdio::null());
    }

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let child = command.spawn();

    match child {
        Ok(child) => {
            app.state::<DesktopHostProcess>().set(child);
        }
        Err(error) => {
            eprintln!(
                "RomDeck host could not be started with {}: {error}",
                node_path.display()
            );
        }
    }

    fn node_executable(app: &tauri::App) -> PathBuf {
        for resource in ["host/node-runtime/node.exe", "host/node-runtime/bin/node"] {
            if let Ok(path) = app.path().resolve(resource, BaseDirectory::Resource) {
                if path.exists() {
                    return path;
                }
            }
        }

        for candidate in [
            "/opt/homebrew/opt/node@20/bin/node",
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
            "node.exe",
            "node",
        ] {
            let path = PathBuf::from(candidate);
            if path.exists() {
                return path;
            }
        }
        PathBuf::from("node")
    }

    fn host_log_file() -> Option<PathBuf> {
        let directory = std::env::temp_dir().join("RomDeck");
        if create_dir_all(&directory).is_err() {
            return None;
        }
        Some(directory.join("romdeck-host.log"))
    }
}

#[cfg(not(mobile))]
fn generate_session_token() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("romdeck-{}-{timestamp}", std::process::id())
}
