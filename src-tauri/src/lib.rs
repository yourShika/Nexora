use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_sql::{Migration, MigrationKind};

mod attach;
mod files;
mod ocr;
mod onenote;
mod run;

fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// Schnellerfassung ein- oder ausblenden; der Hotkey wird im Frontend registriert (einstellbar)
#[tauri::command]
fn toggle_capture(app: AppHandle) {
    toggle(&app)
}

fn toggle(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("capture") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.center();
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "start",
            sql: include_str!("../migrations/001_start.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "datenbanken",
            sql: include_str!("../migrations/002_datenbanken.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "suche",
            sql: include_str!("../migrations/003_suche.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "verlauf",
            sql: include_str!("../migrations/004_verlauf.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "sperre",
            sql: include_str!("../migrations/005_sperre.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "verzahnung",
            sql: include_str!("../migrations/006_verzahnung.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "zeichnen",
            sql: include_str!("../migrations/007_zeichnen.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "texterkennung",
            sql: include_str!("../migrations/008_texterkennung.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        // Zweiter Start holt nur das vorhandene Fenster nach vorn
        .plugin(tauri_plugin_single_instance::init(|app, _, _| show(app)))
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:nexora.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        // Autostart läuft mit --hidden: dann bleibt das Fenster im Tray
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            toggle_capture,
            files::save_image,
            files::import_image,
            files::list_images,
            files::delete_images,
            ocr::ocr_image,
            onenote::onenote,
            files::finish_backup,
            run::shells,
            run::run_script,
            run::cancel_run,
            attach::save_attachment,
            attach::import_attachment,
            attach::open_attachment,
            attach::reveal_attachment,
            attach::read_text_file,
            attach::export_files
        ])
        .manage(run::Runs::default())
        .setup(|app| {
            if !std::env::args().any(|a| a == "--hidden") {
                show(app.handle());
            }
            // Bilderordner anlegen und fürs asset-Protokoll freigeben: der Scope aus tauri.conf.json
            // greift beim allerersten Start nicht, solange der Datenordner noch fehlt
            let images = app.path().app_config_dir()?.join("bilder");
            std::fs::create_dir_all(&images)?;
            app.asset_protocol_scope().allow_directory(&images, true)?;
            let open = MenuItem::with_id(app, "open", "Öffnen", true, None::<&str>)?;
            let quick = MenuItem::with_id(app, "capture", "Schnellerfassung", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &quick, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Nexora")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show(app),
                    "capture" => toggle(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        // Haupt- und Schnellerfassungsfenster verstecken sich beim Schließen nur (Beenden über das Tray); Seitenfenster schließen wirklich
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !matches!(window.label(), "main" | "capture") {
                    return;
                }
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("Nexora konnte nicht starten");
}
