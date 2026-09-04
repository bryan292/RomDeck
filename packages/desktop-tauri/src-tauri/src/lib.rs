#[cfg(not(mobile))]
use std::{
    fs::{create_dir_all, File},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(not(mobile))]
#[derive(Default)]
struct DesktopHostProcess {
    child: Mutex<Option<Child>>,
}

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
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                use tauri::Manager;
                window.app_handle().state::<DesktopHostProcess>().kill();
            }
        });

    builder
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
fn start_desktop_host(app: &mut tauri::App) {
    use tauri::{path::BaseDirectory, Manager};

    let server_path = match app
        .path()
        .resolve("host/desktop-host/dist/server.js", BaseDirectory::Resource)
    {
        Ok(path) => path,
        Err(error) => {
            eprintln!("RomDeck host resource not found: {error}");
            return;
        }
    };

    let resource_root = match app.path().resolve("host", BaseDirectory::Resource) {
        Ok(path) => path,
        Err(error) => {
            eprintln!("RomDeck host resource root not found: {error}");
            return;
        }
    };

    let node_path = node_executable(app);
    let mut command = Command::new(&node_path);
    command.arg(server_path)
        .env("PORT", "5137")
        .current_dir(resource_root)
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
